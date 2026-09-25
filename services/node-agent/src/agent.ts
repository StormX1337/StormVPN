import os from 'node:os';
import type { Logger } from '@stormvpn/config';
import type { AgentHeartbeatInput, AgentHeartbeatResponse } from '@stormvpn/validation';
import { ApiError, type ControlPlaneClient } from './api-client';
import type { AgentConfig } from './config';
import type { HealthChecker } from './health';
import type { SystemMetricsCollector } from './metrics/system';
import { PeerTrafficTracker } from './metrics/traffic';
import { detectPublicIps } from './network';
import type { AgentMetricsSnapshot } from './prometheus';
import type { NodeCredentials, StateStore } from './state';
import type { Updater } from './updater';
import { AGENT_VERSION } from './version';
import type { WireGuardManager } from './wireguard/manager';

const ACTIVE_HANDSHAKE_SECONDS = 180;

export interface AgentDependencies {
  config: AgentConfig;
  client: ControlPlaneClient;
  state: StateStore;
  wireguard: WireGuardManager;
  metrics: SystemMetricsCollector;
  health: HealthChecker;
  updater: Updater;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

/**
 * Agent control loop:
 *   collect metrics + peer stats → heartbeat → if desired revision changed →
 *   pull peer set → `wg syncconf` → report applied revision next heartbeat.
 */
export class NodeAgent {
  private credentials: NodeCredentials | null = null;
  private appliedRevision = 0;
  private intervalSeconds = 15;
  private readonly traffic = new PeerTrafficTracker();
  private publicIp: { ipv4?: string; ipv6?: string; at: number } = { at: 0 };
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  readonly snapshot: AgentMetricsSnapshot = {
    up: false,
    appliedRevision: 0,
    peers: 0,
    activePeers: 0,
    cpuPercent: 0,
    memoryPercent: 0,
    diskPercent: 0,
    rxBps: 0,
    txBps: 0,
    lastHeartbeatSuccess: 0,
    heartbeatFailures: 0,
  };

  constructor(private readonly deps: AgentDependencies) {}

  get serverName(): string {
    return this.credentials?.serverName ?? 'unregistered';
  }

  /** Loads credentials or performs automatic registration with the enrollment token. */
  async ensureRegistered(): Promise<NodeCredentials> {
    const { state, client, config, logger } = this.deps;
    const existing = await state.readCredentials();
    if (existing) {
      this.credentials = existing;
      client.setToken(existing.nodeToken);
      return existing;
    }
    if (!config.STORMVPN_ENROLLMENT_TOKEN) {
      throw new Error('Node is not registered: set STORMVPN_ENROLLMENT_TOKEN (create one in Admin → Servers)');
    }
    const keys = await state.serverKeys();
    const ips = await this.resolvePublicIps(true);
    const response = await client.register({
      enrollmentToken: config.STORMVPN_ENROLLMENT_TOKEN,
      hostname: os.hostname().toLowerCase(),
      agentVersion: AGENT_VERSION,
      wireguardPublicKey: keys.publicKey,
      publicIpv4: ips.ipv4,
      publicIpv6: ips.ipv6,
      os: `${os.type()} ${os.release()}`.slice(0, 120),
      kernel: os.release().slice(0, 120),
    });
    const credentials: NodeCredentials = {
      apiUrl: config.STORMVPN_API_URL,
      nodeId: response.nodeId,
      serverId: response.serverId,
      serverName: response.serverName,
      nodeToken: response.nodeToken,
      tokenIssuedAt: new Date().toISOString(),
    };
    await state.writeCredentials(credentials);
    client.setToken(credentials.nodeToken);
    this.credentials = credentials;
    this.intervalSeconds = response.heartbeatIntervalSeconds;
    logger.info({ nodeId: response.nodeId, server: response.serverName }, 'node registered');
    return credentials;
  }

  private async resolvePublicIps(force = false): Promise<{ ipv4?: string; ipv6?: string }> {
    if (!force && Date.now() - this.publicIp.at < 15 * 60_000) return this.publicIp;
    const { config, fetchImpl } = this.deps;
    const ips = await detectPublicIps({
      ipv4Override: config.PUBLIC_IPV4,
      ipv6Override: config.PUBLIC_IPV6,
      echoUrls: config.PUBLIC_IP_ECHO_URLS,
      timeoutMs: 5_000,
      fetchImpl,
    });
    this.publicIp = { ...ips, at: Date.now() };
    return ips;
  }

  /** Pulls and applies the desired WireGuard state. */
  async syncConfig(force = false): Promise<void> {
    const config = await this.deps.client.config(force ? null : this.appliedRevision);
    if (!config) return;
    await this.deps.wireguard.apply(config);
    this.appliedRevision = config.revision;
    this.snapshot.appliedRevision = config.revision;
    this.deps.logger.info({ revision: config.revision, peers: config.peers.length }, 'WireGuard configuration applied');
  }

  private async buildHeartbeat(): Promise<{ body: AgentHeartbeatInput; stats: AgentHeartbeatInput['peers'] }> {
    const [system, status, health, ips] = await Promise.all([
      this.deps.metrics.collect(),
      this.deps.wireguard.status(),
      this.deps.health.run(),
      this.resolvePublicIps(),
    ]);
    const peers = status?.peers ?? [];
    const now = Math.floor(Date.now() / 1000);
    const stats = this.traffic.collect(peers, now);
    Object.assign(this.snapshot, {
      up: status !== null,
      peers: peers.length,
      activePeers: peers.filter((peer) => peer.latestHandshake > 0 && now - peer.latestHandshake < ACTIVE_HANDSHAKE_SECONDS).length,
      cpuPercent: system.cpuPercent,
      memoryPercent: system.memoryPercent,
      diskPercent: system.diskPercent,
      rxBps: system.rxBps,
      txBps: system.txBps,
    });
    return {
      stats,
      body: {
        agentVersion: AGENT_VERSION,
        metrics: system,
        wireguard: {
          interfaceUp: status !== null,
          listenPort: status?.listenPort ?? 0,
          peerCount: peers.length,
          appliedRevision: this.appliedRevision,
          totalRxBytes: peers.reduce((sum, peer) => sum + peer.rxBytes, 0),
          totalTxBytes: peers.reduce((sum, peer) => sum + peer.txBytes, 0),
        },
        publicIpv4: ips.ipv4,
        publicIpv6: ips.ipv6,
        health,
        peers: stats,
      },
    };
  }

  /** One control-loop iteration; returns the heartbeat response. */
  async tick(): Promise<AgentHeartbeatResponse> {
    const { body, stats } = await this.buildHeartbeat();
    let response: AgentHeartbeatResponse;
    try {
      response = await this.deps.client.heartbeat(body);
    } catch (error) {
      this.traffic.rollback(stats);
      this.snapshot.heartbeatFailures++;
      throw error;
    }
    this.snapshot.lastHeartbeatSuccess = Math.floor(Date.now() / 1000);
    this.intervalSeconds = response.heartbeatIntervalSeconds;
    if (response.desiredRevision !== this.appliedRevision || body.wireguard.interfaceUp === false) {
      await this.syncConfig(!body.wireguard.interfaceUp);
    }
    await this.deps.updater.check(response.desiredAgentVersion, response.updateUrl);
    await this.maybeRotateToken();
    return response;
  }

  private async maybeRotateToken(): Promise<void> {
    const credentials = this.credentials;
    if (!credentials) return;
    const ageDays = (Date.now() - new Date(credentials.tokenIssuedAt).getTime()) / 86_400_000;
    if (ageDays < this.deps.config.TOKEN_ROTATION_DAYS) return;
    const nodeToken = await this.deps.client.rotateToken();
    this.credentials = { ...credentials, nodeToken, tokenIssuedAt: new Date().toISOString() };
    await this.deps.state.writeCredentials(this.credentials);
    this.deps.client.setToken(nodeToken);
    this.deps.logger.info('node token rotated');
  }

  async start(): Promise<void> {
    await this.ensureRegistered();
    await this.syncConfig(true).catch((error: unknown) => this.deps.logger.error({ err: error }, 'initial sync failed'));
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.tick();
      } catch (error) {
        const fatal = error instanceof ApiError && error.status === 401;
        this.deps.logger.error({ err: error }, fatal ? 'node token rejected – re-enrollment required' : 'heartbeat failed');
      }
      if (!this.stopped) this.timer = setTimeout(() => void loop(), this.intervalSeconds * 1000);
    };
    await loop();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
