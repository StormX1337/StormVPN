import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { safeEqual } from '@stormvpn/crypto/node';
import { type Database, toNumber } from '@stormvpn/database';
import { isPrivateIPv4 } from '@stormvpn/validation';
import type { ApiEnv } from '../env';
import { forbidden } from '../lib/errors';

export const API_COUNTER_PREFIX = 'stats:api';

/** Key of today's API request / error counters (UTC day). */
export function apiCounterKey(kind: 'requests' | 'errors', date = new Date()): string {
  return `${API_COUNTER_PREFIX}:${kind}:${date.toISOString().slice(0, 10)}`;
}

function createBusinessGauges(registry: Registry, db: Database): void {
  const nodes = new Gauge({ name: 'stormvpn_nodes', help: 'VPN nodes by status', labelNames: ['status'], registers: [registry] });
  const connections = new Gauge({
    name: 'stormvpn_vpn_connections',
    help: 'VPN connections by status',
    labelNames: ['status'],
    registers: [registry],
  });
  const peers = new Gauge({ name: 'stormvpn_wireguard_peers', help: 'Active WireGuard peers', registers: [registry] });
  const nodeCpu = new Gauge({ name: 'stormvpn_node_cpu_percent', help: 'Node CPU usage', labelNames: ['server'], registers: [registry] });
  const nodeMem = new Gauge({ name: 'stormvpn_node_memory_percent', help: 'Node memory usage', labelNames: ['server'], registers: [registry] });
  const nodeDisk = new Gauge({ name: 'stormvpn_node_disk_percent', help: 'Node disk usage', labelNames: ['server'], registers: [registry] });
  const nodeLoad = new Gauge({ name: 'stormvpn_node_load_percent', help: 'Node load score', labelNames: ['server'], registers: [registry] });
  const nodeConn = new Gauge({
    name: 'stormvpn_node_active_connections',
    help: 'Active connections per node',
    labelNames: ['server'],
    registers: [registry],
  });
  const nodeRx = new Gauge({ name: 'stormvpn_node_rx_bytes_per_second', help: 'Node receive rate', labelNames: ['server'], registers: [registry] });
  const nodeTx = new Gauge({ name: 'stormvpn_node_tx_bytes_per_second', help: 'Node transmit rate', labelNames: ['server'], registers: [registry] });
  const nodeUptime = new Gauge({ name: 'stormvpn_node_uptime_seconds', help: 'Node uptime', labelNames: ['server'], registers: [registry] });
  const nodeUp = new Gauge({ name: 'stormvpn_node_up', help: '1 when the node is ONLINE', labelNames: ['server'], registers: [registry] });

  // Collected lazily on scrape so metrics reflect the database state across all API replicas.
  new Gauge({
    name: 'stormvpn_business_scrape_success',
    help: 'Whether the last business metrics collection succeeded',
    registers: [registry],
    async collect() {
      try {
        const [nodeGroups, connectionGroups, peerCount, nodeRows] = await Promise.all([
          db.vPNNode.groupBy({ by: ['status'], _count: { _all: true } }),
          db.vPNConnection.groupBy({ by: ['status'], where: { status: { in: ['CONNECTING', 'CONNECTED'] } }, _count: { _all: true } }),
          db.vPNPeer.count({ where: { status: 'ACTIVE' } }),
          db.vPNNode.findMany({ select: { status: true, cpuPercent: true, memoryPercent: true, diskPercent: true, loadPercent: true, activeConnections: true, rxBps: true, txBps: true, uptimeSeconds: true, server: { select: { name: true } } } }),
        ]);
        nodes.reset();
        for (const status of ['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']) nodes.set({ status }, 0);
        for (const group of nodeGroups) nodes.set({ status: group.status }, group._count._all);
        connections.reset();
        for (const group of connectionGroups) connections.set({ status: group.status }, group._count._all);
        peers.set(peerCount);
        for (const gauge of [nodeCpu, nodeMem, nodeDisk, nodeLoad, nodeConn, nodeRx, nodeTx, nodeUptime, nodeUp]) gauge.reset();
        for (const node of nodeRows) {
          const server = node.server.name;
          nodeCpu.set({ server }, node.cpuPercent);
          nodeMem.set({ server }, node.memoryPercent);
          nodeDisk.set({ server }, node.diskPercent);
          nodeLoad.set({ server }, node.loadPercent);
          nodeConn.set({ server }, node.activeConnections);
          nodeRx.set({ server }, toNumber(node.rxBps));
          nodeTx.set({ server }, toNumber(node.txBps));
          nodeUptime.set({ server }, toNumber(node.uptimeSeconds));
          nodeUp.set({ server }, node.status === 'ONLINE' ? 1 : 0);
        }
        this.set(1);
      } catch {
        this.set(0);
      }
    },
  });
}

function authorizeScrape(request: FastifyRequest, env: ApiEnv): void {
  if (env.METRICS_TOKEN) {
    const header = request.headers.authorization ?? '';
    if (!safeEqual(header, `Bearer ${env.METRICS_TOKEN}`)) throw forbidden('metrics_forbidden', 'Invalid metrics token');
    return;
  }
  const ip = request.ip.replace(/^::ffff:/, '');
  if (!(ip === '127.0.0.1' || ip === '::1' || isPrivateIPv4(ip))) {
    throw forbidden('metrics_forbidden', 'Metrics are only available from internal networks');
  }
}

/**
 * Prometheus metrics (`GET /metrics`) + lightweight per-day request/error
 * counters in Redis that feed the live admin dashboard.
 */
export const metricsPlugin = fp(
  async (app: FastifyInstance, opts: { env: ApiEnv; db: Database; redis: Redis; collectBusiness?: boolean }) => {
    const registry = new Registry();
    registry.setDefaultLabels({ service: 'stormvpn-api' });
    collectDefaultMetrics({ register: registry });
    if (opts.collectBusiness !== false) createBusinessGauges(registry, opts.db);

    const duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    });
    const errors = new Counter({
      name: 'http_request_errors_total',
      help: 'HTTP responses with status >= 500',
      labelNames: ['method', 'route'],
      registers: [registry],
    });

    let pendingRequests = 0;
    let pendingErrors = 0;
    const flush = async () => {
      if (pendingRequests === 0 && pendingErrors === 0) return;
      const [requests, failures] = [pendingRequests, pendingErrors];
      pendingRequests = 0;
      pendingErrors = 0;
      const pipeline = opts.redis.pipeline();
      pipeline.incrby(apiCounterKey('requests'), requests).expire(apiCounterKey('requests'), 3 * 86_400);
      if (failures > 0) pipeline.incrby(apiCounterKey('errors'), failures).expire(apiCounterKey('errors'), 3 * 86_400);
      await pipeline.exec().catch(() => undefined);
    };
    const timer = setInterval(() => void flush(), 5_000);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
      await flush();
    });

    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? 'unmatched';
      if (route === '/metrics') return;
      duration.observe({ method: request.method, route, status: String(reply.statusCode) }, reply.elapsedTime / 1000);
      pendingRequests++;
      if (reply.statusCode >= 500) {
        errors.inc({ method: request.method, route });
        pendingErrors++;
      }
    });

    app.get('/metrics', { config: { rateLimit: false, csrf: false } }, async (request, reply) => {
      authorizeScrape(request, opts.env);
      void reply.header('content-type', registry.contentType);
      return registry.metrics();
    });
  },
);
