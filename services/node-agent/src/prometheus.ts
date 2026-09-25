import { createServer, type Server } from 'node:http';

export interface AgentMetricsSnapshot {
  up: boolean;
  appliedRevision: number;
  peers: number;
  activePeers: number;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  rxBps: number;
  txBps: number;
  lastHeartbeatSuccess: number;
  heartbeatFailures: number;
}

/** Renders the Prometheus text exposition format (no client library needed). */
export function renderMetrics(snapshot: AgentMetricsSnapshot, labels: Record<string, string>): string {
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${value.replace(/["\\\n]/g, '')}"`)
    .join(',');
  const metric = (name: string, help: string, type: 'gauge' | 'counter', value: number) =>
    `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name}{${labelText}} ${value}`;
  return [
    metric('stormvpn_agent_wireguard_up', 'WireGuard interface is up', 'gauge', snapshot.up ? 1 : 0),
    metric('stormvpn_agent_applied_revision', 'Applied peer configuration revision', 'gauge', snapshot.appliedRevision),
    metric('stormvpn_agent_wireguard_peers', 'Configured WireGuard peers', 'gauge', snapshot.peers),
    metric('stormvpn_agent_wireguard_active_peers', 'Peers with a recent handshake', 'gauge', snapshot.activePeers),
    metric('stormvpn_agent_cpu_percent', 'CPU usage', 'gauge', snapshot.cpuPercent),
    metric('stormvpn_agent_memory_percent', 'Memory usage', 'gauge', snapshot.memoryPercent),
    metric('stormvpn_agent_disk_percent', 'Root filesystem usage', 'gauge', snapshot.diskPercent),
    metric('stormvpn_agent_rx_bytes_per_second', 'WAN receive rate', 'gauge', snapshot.rxBps),
    metric('stormvpn_agent_tx_bytes_per_second', 'WAN transmit rate', 'gauge', snapshot.txBps),
    metric('stormvpn_agent_last_heartbeat_success_timestamp_seconds', 'Last successful heartbeat', 'gauge', snapshot.lastHeartbeatSuccess),
    metric('stormvpn_agent_heartbeat_failures_total', 'Failed heartbeats', 'counter', snapshot.heartbeatFailures),
    '',
  ].join('\n');
}

export function startMetricsServer(host: string, port: number, snapshot: () => AgentMetricsSnapshot, labels: () => Record<string, string>): Server {
  return createServer((request, response) => {
    if (request.url === '/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(renderMetrics(snapshot(), labels()));
    } else if (request.url === '/health') {
      const ok = snapshot().up;
      response.writeHead(ok ? 200 : 503).end(ok ? 'ok' : 'wireguard down');
    } else {
      response.writeHead(404).end();
    }
  }).listen(port, host);
}
