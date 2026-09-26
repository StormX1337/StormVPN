import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@stormvpn/config';
import type {
  AgentConfigResponse,
  AgentHeartbeatInput,
  AgentHeartbeatResponse,
} from '@stormvpn/validation';
import { type AgentDependencies, NodeAgent } from '../agent';
import { ApiError, type ControlPlaneClient } from '../api-client';
import { loadAgentConfig } from '../config';
import type { HealthChecker } from '../health';
import type { SystemMetricsCollector } from '../metrics/system';
import { StateStore } from '../state';
import { Updater } from '../updater';
import type { WireGuardManager } from '../wireguard/manager';
import type { WgInterfaceStatus } from '../wireguard/dump';

const logger = createLogger({ name: 'test', level: 'silent' });

class FakeClient {
  heartbeats: AgentHeartbeatInput[] = [];
  configCalls: (number | null)[] = [];
  desiredRevision = 5;
  failNext = false;
  registered = 0;
  token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }
  async register() {
    this.registered++;
    return {
      nodeId: 'node-1',
      serverId: 'server-1',
      serverName: 'DE-FRA-01',
      nodeToken: 'snt_token',
      heartbeatIntervalSeconds: 15,
    };
  }
  async heartbeat(body: AgentHeartbeatInput): Promise<AgentHeartbeatResponse> {
    if (this.failNext) {
      this.failNext = false;
      throw new ApiError(503, 'unavailable', 'down');
    }
    this.heartbeats.push(body);
    return {
      nodeId: 'node-1',
      desiredRevision: this.desiredRevision,
      heartbeatIntervalSeconds: 15,
      maintenance: false,
      killSwitch: false,
      desiredAgentVersion: null,
      updateUrl: null,
    };
  }
  async config(known: number | null): Promise<AgentConfigResponse | null> {
    this.configCalls.push(known);
    if (known === this.desiredRevision) return null;
    return {
      revision: this.desiredRevision,
      interface: {
        listenPort: 51820,
        addressV4: '10.80.0.1/20',
        addressV6: null,
        subnetV4: '10.80.0.0/20',
        subnetV6: null,
        dns: [],
      },
      peers: [],
    };
  }
  async rotateToken() {
    return 'snt_rotated';
  }
}

class FakeWireGuard implements WireGuardManager {
  applied: AgentConfigResponse[] = [];
  peers: WgInterfaceStatus['peers'] = [];
  async isUp() {
    return this.applied.length > 0;
  }
  async apply(config: AgentConfigResponse) {
    this.applied.push(config);
  }
  async status() {
    return this.applied.length ? { publicKey: 'X', listenPort: 51820, peers: this.peers } : null;
  }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-'));
  const config = loadAgentConfig({
    STORMVPN_API_URL: 'https://api.stormvpn.test',
    STORMVPN_ENROLLMENT_TOKEN: 'sne_0123456789abcdefghijklmnop',
    STORMVPN_STATE_DIR: dir,
    PUBLIC_IPV4: '203.0.113.20',
  });
  const client = new FakeClient();
  const wireguard = new FakeWireGuard();
  const metrics = {
    collect: async () => ({
      cpuPercent: 5,
      memoryPercent: 10,
      memoryTotalBytes: 1,
      diskPercent: 20,
      rxBps: 0,
      txBps: 0,
      uptimeSeconds: 1,
      loadAverage: [0, 0, 0] as [number, number, number],
    }),
  };
  const health = { run: async () => ({ wireguard: { ok: true } }) };
  const agent = new NodeAgent({
    config,
    client: client as unknown as ControlPlaneClient,
    state: new StateStore(dir),
    wireguard,
    metrics: metrics as unknown as SystemMetricsCollector,
    health: health as unknown as HealthChecker,
    updater: new Updater(
      false,
      '/bin/false',
      { run: async () => ({ stdout: '', stderr: '' }) },
      logger,
    ),
    logger,
  });
  return { agent, client, wireguard, dir, config };
}

describe('NodeAgent', () => {
  it('registers once and persists credentials', async () => {
    const { agent, client, dir, config } = await setup();
    await agent.ensureRegistered();
    expect(client.registered).toBe(1);
    expect(client.token).toBe('snt_token');
    const again = new NodeAgent({
      ...(agent as unknown as { deps: AgentDependencies }).deps,
      config,
    });
    await again.ensureRegistered();
    expect(client.registered).toBe(1);
    expect((await new StateStore(dir).readCredentials())?.serverName).toBe('DE-FRA-01');
  });

  it('syncs when the desired revision changes and reports the applied revision', async () => {
    const { agent, client, wireguard } = await setup();
    await agent.ensureRegistered();
    await agent.tick();
    expect(wireguard.applied.map((config) => config.revision)).toEqual([5]);
    await agent.tick();
    expect(wireguard.applied).toHaveLength(1);
    expect(client.heartbeats.at(-1)!.wireguard.appliedRevision).toBe(5);
    client.desiredRevision = 6;
    await agent.tick();
    expect(wireguard.applied.map((config) => config.revision)).toEqual([5, 6]);
  });

  it('keeps peer traffic deltas when a heartbeat fails', async () => {
    const { agent, client, wireguard } = await setup();
    await agent.ensureRegistered();
    await agent.syncConfig(true);
    const now = Math.floor(Date.now() / 1000);
    wireguard.peers = [
      {
        publicKey: 'P=',
        endpoint: null,
        allowedIps: [],
        latestHandshake: now,
        rxBytes: 1000,
        txBytes: 2000,
      },
    ];
    client.failNext = true;
    await expect(agent.tick()).rejects.toThrow();
    wireguard.peers = [
      {
        publicKey: 'P=',
        endpoint: null,
        allowedIps: [],
        latestHandshake: now,
        rxBytes: 1500,
        txBytes: 2500,
      },
    ];
    await agent.tick();
    expect(client.heartbeats.at(-1)!.peers[0]).toMatchObject({
      rxBytesDelta: 1500,
      txBytesDelta: 2500,
    });
    expect(agent.snapshot.heartbeatFailures).toBe(1);
  });

  it('requires https for the control plane unless explicitly allowed', () => {
    expect(() => loadAgentConfig({ STORMVPN_API_URL: 'http://api.test' })).toThrow(/https/);
    expect(
      loadAgentConfig({ STORMVPN_API_URL: 'http://api.test', AGENT_ALLOW_INSECURE_HTTP: 'true' })
        .AGENT_ALLOW_INSECURE_HTTP,
    ).toBe(true);
  });
});
