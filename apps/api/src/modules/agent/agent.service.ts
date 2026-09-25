import type { Redis } from 'ioredis';
import { generatePrefixedToken, sha256Hex } from '@stormvpn/crypto/node';
import {
  computeServerLoad,
  type EventPublisher,
  recordSecurityEvent,
  writeAuditLog,
} from '@stormvpn/core';
import { type Database, type NodeStatus, toNumber, type VPNNode } from '@stormvpn/database';
import type {
  AgentConfigResponse,
  AgentHeartbeatInput,
  AgentHeartbeatResponse,
  AgentRegisterInput,
  AgentRegisterResponse,
} from '@stormvpn/validation';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import { unauthorized } from '../../lib/errors';
import type { ServerCatalog } from '../servers/server-catalog';
import { gatewayAddress, subnetPrefix } from '../wireguard/ip-allocator';
import type { PeerService } from '../wireguard/peer.service';
import type { TelemetryService } from './telemetry.service';

const HISTORY_SAMPLE_SECONDS = 60;

export class AgentService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly peers: PeerService,
    private readonly telemetry: TelemetryService,
    private readonly catalog: ServerCatalog,
    private readonly events: EventPublisher,
    private readonly env: ApiEnv,
    private readonly clock: Clock,
  ) {}

  /**
   * Automatic registration: the agent presents a one-time enrollment token
   * issued by an admin for a specific server and receives a long-lived node
   * token. The server's WireGuard private key is generated on the node and
   * never leaves it – only the public key is registered.
   */
  async register(input: AgentRegisterInput, ipAddress: string): Promise<AgentRegisterResponse> {
    const now = this.clock.now();
    const server = await this.db.vPNServer.findUnique({ where: { enrollmentTokenHash: sha256Hex(input.enrollmentToken) } });
    if (!server || !server.enrollmentExpiresAt || server.enrollmentExpiresAt <= now || server.deletedAt) {
      await recordSecurityEvent(this.db, { type: 'NODE_AUTH_FAILED', ipAddress, metadata: { stage: 'enrollment' } });
      throw unauthorized('invalid_enrollment_token', 'Enrollment token is invalid or expired');
    }
    const nodeToken = generatePrefixedToken('snt', 32);
    const data = {
      tokenHash: sha256Hex(nodeToken),
      tokenPrefix: nodeToken.slice(0, 12),
      status: 'OFFLINE' as const,
      agentVersion: input.agentVersion,
      hostname: input.hostname,
      os: input.os ?? null,
      kernel: input.kernel ?? null,
      wireguardPublicKey: input.wireguardPublicKey,
      publicIpv4: input.publicIpv4 ?? null,
      publicIpv6: input.publicIpv6 ?? null,
      appliedPeerRevision: 0,
      registeredAt: now,
      tokenRotatedAt: now,
    };
    const node = await this.db.$transaction(async (tx) => {
      const saved = await tx.vPNNode.upsert({ where: { serverId: server.id }, create: { serverId: server.id, ...data }, update: data });
      await tx.vPNServer.update({
        where: { id: server.id },
        data: { enrollmentTokenHash: null, enrollmentExpiresAt: null, peerRevision: { increment: 1 } },
      });
      return saved;
    });
    this.catalog.invalidate();
    await recordSecurityEvent(this.db, {
      type: 'NODE_REGISTERED',
      ipAddress,
      metadata: { serverId: server.id, serverName: server.name, hostname: input.hostname },
    });
    await writeAuditLog(this.db, {
      actorId: null,
      actorType: 'NODE',
      action: 'node.register',
      targetType: 'server',
      targetId: server.id,
      ipAddress,
      metadata: { nodeId: node.id, agentVersion: input.agentVersion },
    });
    return {
      nodeId: node.id,
      serverId: server.id,
      serverName: server.name,
      nodeToken,
      heartbeatIntervalSeconds: this.env.NODE_HEARTBEAT_INTERVAL_SECONDS,
    };
  }

  private deriveStatus(serverStatus: string, heartbeat: AgentHeartbeatInput): NodeStatus {
    if (serverStatus === 'MAINTENANCE') return 'MAINTENANCE';
    const failing = Object.values(heartbeat.health).some((check) => !check.ok);
    if (!heartbeat.wireguard.interfaceUp || failing || heartbeat.metrics.diskPercent > 95) return 'DEGRADED';
    return 'ONLINE';
  }

  async heartbeat(nodeId: string, input: AgentHeartbeatInput): Promise<AgentHeartbeatResponse> {
    const now = this.clock.now();
    const node = await this.db.vPNNode.findUniqueOrThrow({ where: { id: nodeId }, include: { server: true } });
    const { server } = node;

    const telemetry = await this.telemetry.ingest(server.id, input.peers);
    const status = this.deriveStatus(server.status, input);
    const load = computeServerLoad({
      activeConnections: telemetry.activeConnections,
      capacity: server.capacity,
      cpuPercent: input.metrics.cpuPercent,
      rxBps: input.metrics.rxBps,
      txBps: input.metrics.txBps,
      bandwidthCapacityMbps: server.bandwidthCapacityMbps,
    });

    const updated = await this.db.vPNNode.update({
      where: { id: nodeId },
      data: {
        status,
        agentVersion: input.agentVersion,
        publicIpv4: input.publicIpv4 ?? node.publicIpv4,
        publicIpv6: input.publicIpv6 ?? node.publicIpv6,
        cpuPercent: input.metrics.cpuPercent,
        memoryPercent: input.metrics.memoryPercent,
        memoryTotalBytes: BigInt(Math.floor(input.metrics.memoryTotalBytes)),
        diskPercent: input.metrics.diskPercent,
        rxBps: BigInt(Math.floor(input.metrics.rxBps)),
        txBps: BigInt(Math.floor(input.metrics.txBps)),
        loadPercent: load,
        activeConnections: telemetry.activeConnections,
        activePeers: input.wireguard.peerCount,
        totalRxBytes: BigInt(Math.floor(input.wireguard.totalRxBytes)),
        totalTxBytes: BigInt(Math.floor(input.wireguard.totalTxBytes)),
        uptimeSeconds: BigInt(Math.floor(input.metrics.uptimeSeconds)),
        appliedPeerRevision: input.wireguard.appliedRevision,
        healthChecks: input.health as never,
        lastHeartbeatAt: now,
      },
    });

    if (await this.redis.set(`hb:sample:${nodeId}`, '1', 'EX', HISTORY_SAMPLE_SECONDS, 'NX')) {
      await this.db.nodeHeartbeat.create({
        data: {
          nodeId,
          status,
          cpuPercent: input.metrics.cpuPercent,
          memoryPercent: input.metrics.memoryPercent,
          diskPercent: input.metrics.diskPercent,
          rxBps: updated.rxBps,
          txBps: updated.txBps,
          loadPercent: load,
          activeConnections: telemetry.activeConnections,
          activePeers: input.wireguard.peerCount,
        },
      });
    }
    if (node.status !== status) this.catalog.invalidate();
    await this.publishNode(updated, server.name);

    return {
      nodeId,
      desiredRevision: server.peerRevision,
      heartbeatIntervalSeconds: this.env.NODE_HEARTBEAT_INTERVAL_SECONDS,
      maintenance: server.status === 'MAINTENANCE',
      killSwitch: server.killSwitchEngaged,
      desiredAgentVersion: this.env.AGENT_LATEST_VERSION ?? null,
      updateUrl:
        this.env.AGENT_LATEST_VERSION && this.env.AGENT_UPDATE_BASE_URL
          ? `${this.env.AGENT_UPDATE_BASE_URL}/stormvpn-agent-${this.env.AGENT_LATEST_VERSION}.tar.gz`
          : null,
    };
  }

  /**
   * Desired WireGuard state for the node. With the server kill switch engaged
   * or the server disabled, the peer list is empty so the node drops everyone.
   */
  async config(serverId: string): Promise<AgentConfigResponse> {
    const server = await this.db.vPNServer.findUniqueOrThrow({ where: { id: serverId } });
    const blocked = server.killSwitchEngaged || server.status === 'DISABLED' || server.deletedAt !== null;
    const peers = blocked
      ? []
      : await this.db.vPNPeer.findMany({
          where: { serverId, status: 'ACTIVE', user: { status: 'ACTIVE', deletedAt: null } },
          select: { publicKey: true, presharedKeyEnc: true, ipv4Address: true, ipv6Address: true, serverId: true },
          orderBy: { ipv4Address: 'asc' },
        });
    const prefix = subnetPrefix(server.wgSubnetV4);
    const v6Base = server.wgSubnetV6?.split('/')[0];
    return {
      revision: server.peerRevision,
      interface: {
        listenPort: server.wireguardPort,
        addressV4: `${gatewayAddress(server.wgSubnetV4)}/${prefix}`,
        addressV6: v6Base ? `${v6Base.endsWith('::') ? `${v6Base}1` : v6Base}/${server.wgSubnetV6!.split('/')[1]}` : null,
        subnetV4: server.wgSubnetV4,
        subnetV6: server.wgSubnetV6,
        dns: server.dnsServers,
      },
      peers: peers.map((peer) => ({
        publicKey: peer.publicKey,
        presharedKey: this.peers.decryptPresharedKey(peer),
        allowedIps: [`${peer.ipv4Address}/32`, ...(peer.ipv6Address ? [`${peer.ipv6Address}/128`] : [])],
      })),
    };
  }

  async rotateToken(nodeId: string): Promise<{ nodeToken: string }> {
    const nodeToken = generatePrefixedToken('snt', 32);
    await this.db.vPNNode.update({
      where: { id: nodeId },
      data: { tokenHash: sha256Hex(nodeToken), tokenPrefix: nodeToken.slice(0, 12), tokenRotatedAt: this.clock.now() },
    });
    return { nodeToken };
  }

  private async publishNode(node: VPNNode, serverName: string): Promise<void> {
    await this.events.toAdmins({
      type: 'admin.node',
      data: {
        id: node.id,
        serverId: node.serverId,
        serverName,
        status: node.status,
        lastHeartbeatAt: node.lastHeartbeatAt?.toISOString() ?? null,
        metrics: {
          cpuPercent: node.cpuPercent,
          memoryPercent: node.memoryPercent,
          diskPercent: node.diskPercent,
          rxBps: toNumber(node.rxBps),
          txBps: toNumber(node.txBps),
          bandwidthMbps: (Math.max(toNumber(node.rxBps), toNumber(node.txBps)) * 8) / 1_000_000,
          activeConnections: node.activeConnections,
          activePeers: node.activePeers,
          load: node.loadPercent,
          uptimeSeconds: toNumber(node.uptimeSeconds),
        },
      },
    });
  }
}
