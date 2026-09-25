import { generatePrefixedToken, sha256Hex } from '@stormvpn/crypto/node';
import {
  type ActorContext,
  addDays,
  bumpPeerRevision,
  isoDay,
  recordSecurityEvent,
  startOfUtcDay,
  writeAuditLog,
} from '@stormvpn/core';
import { type Database, isUniqueViolation, type Prisma, type ServerStatus, toNumber } from '@stormvpn/database';
import type {
  AdminConnectionDto,
  AdminNodeDto,
  AdminServerDto,
  AdminTrafficDto,
  EnrollmentTokenDto,
  Paginated,
} from '@stormvpn/types';
import type { ServerCreateInput, ServerUpdateInput } from '@stormvpn/validation';
import { ipv4CidrRange } from '@stormvpn/validation';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import { conflict, notFound } from '../../lib/errors';
import { pageArgs, paginated } from '../../lib/pagination';
import type { ConnectionService } from '../connections/connection.service';
import type { ServerCatalog } from '../servers/server-catalog';
import { toAdminNodeDto, toAdminServerDto } from './admin.mappers';

export class AdminInfraService {
  constructor(
    private readonly db: Database,
    private readonly catalog: ServerCatalog,
    private readonly connections: ConnectionService,
    private readonly env: Pick<ApiEnv, 'NODE_ENROLLMENT_TTL_HOURS' | 'APP_URL'>,
    private readonly clock: Clock,
  ) {}

  // ── Servers ──────────────────────────────────────────────

  async listServers(): Promise<AdminServerDto[]> {
    const [servers, peerCounts] = await Promise.all([
      this.db.vPNServer.findMany({ where: { deletedAt: null }, include: { node: true }, orderBy: { name: 'asc' } }),
      this.db.vPNPeer.groupBy({ by: ['serverId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
    ]);
    const counts = new Map(peerCounts.map((row) => [row.serverId, row._count._all]));
    return servers.map((server) => toAdminServerDto(server, counts.get(server.id) ?? 0, server.node ? this.catalog.status(server) : null));
  }

  async getServer(id: string): Promise<AdminServerDto> {
    const server = await this.db.vPNServer.findFirst({ where: { id, deletedAt: null }, include: { node: true } });
    if (!server) throw notFound('Server');
    const peers = await this.db.vPNPeer.count({ where: { serverId: id, status: 'ACTIVE' } });
    return toAdminServerDto(server, peers, server.node ? this.catalog.status(server) : null);
  }

  private async assertSubnetFree(subnet: string, excludeId?: string): Promise<void> {
    const range = ipv4CidrRange(subnet)!;
    const others = await this.db.vPNServer.findMany({
      where: { deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { name: true, wgSubnetV4: true },
    });
    for (const other of others) {
      const otherRange = ipv4CidrRange(other.wgSubnetV4);
      if (!otherRange) continue;
      const overlaps = range.network < otherRange.network + otherRange.size && otherRange.network < range.network + range.size;
      if (overlaps) throw conflict('subnet_overlap', `Client subnet overlaps with ${other.name} (${other.wgSubnetV4})`);
    }
  }

  async createServer(input: ServerCreateInput, actor: ActorContext): Promise<AdminServerDto> {
    await this.assertSubnetFree(input.wgSubnetV4);
    try {
      const server = await this.db.vPNServer.create({ data: { ...input, dnsServers: input.dnsServers ?? [] } });
      this.catalog.invalidate();
      await writeAuditLog(this.db, { ...actor, action: 'server.create', targetType: 'server', targetId: server.id, metadata: { name: server.name } });
      return this.getServer(server.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('server_exists', 'A server with this name or hostname already exists');
      throw error;
    }
  }

  async updateServer(id: string, input: ServerUpdateInput, actor: ActorContext): Promise<AdminServerDto> {
    const existing = await this.db.vPNServer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw notFound('Server');
    if (input.wgSubnetV4 && input.wgSubnetV4 !== existing.wgSubnetV4) {
      const peers = await this.db.vPNPeer.count({ where: { serverId: id } });
      if (peers > 0) throw conflict('subnet_in_use', 'The client subnet cannot change while peers exist');
      await this.assertSubnetFree(input.wgSubnetV4, id);
    }
    await this.db.$transaction(async (tx) => {
      await tx.vPNServer.update({ where: { id }, data: input });
      await bumpPeerRevision(tx, [id]);
    });
    this.catalog.invalidate();
    await writeAuditLog(this.db, { ...actor, action: 'server.update', targetType: 'server', targetId: id, metadata: input as Record<string, unknown> });
    return this.getServer(id);
  }

  async setServerStatus(id: string, status: ServerStatus, actor: ActorContext): Promise<AdminServerDto> {
    await this.db.$transaction(async (tx) => {
      await tx.vPNServer.update({ where: { id }, data: { status } });
      if (status === 'MAINTENANCE') await tx.vPNNode.updateMany({ where: { serverId: id }, data: { status: 'MAINTENANCE' } });
      await bumpPeerRevision(tx, [id]);
    });
    this.catalog.invalidate();
    await writeAuditLog(this.db, { ...actor, action: 'server.status', targetType: 'server', targetId: id, metadata: { status } });
    return this.getServer(id);
  }

  /** Emergency stop: the node removes every peer on its next sync and no new users are assigned. */
  async setKillSwitch(id: string, engaged: boolean, reason: string, actor: ActorContext): Promise<AdminServerDto> {
    const now = this.clock.now();
    await this.db.$transaction(async (tx) => {
      await tx.vPNServer.update({
        where: { id },
        data: { killSwitchEngaged: engaged, killSwitchReason: engaged ? reason : null, peerRevision: { increment: 1 } },
      });
      if (engaged) {
        await tx.vPNConnection.updateMany({
          where: { serverId: id, status: { in: ['CONNECTING', 'CONNECTED'] } },
          data: { status: 'DISCONNECTED', endedAt: now, disconnectReason: 'server_kill_switch' },
        });
      }
    });
    this.catalog.invalidate();
    await recordSecurityEvent(this.db, {
      type: 'SERVER_KILL_SWITCH',
      severity: engaged ? 'CRITICAL' : 'MEDIUM',
      ipAddress: actor.ipAddress ?? null,
      metadata: { serverId: id, engaged, reason },
    });
    await writeAuditLog(this.db, { ...actor, action: engaged ? 'server.kill_switch.engage' : 'server.kill_switch.release', targetType: 'server', targetId: id, metadata: { reason } });
    return this.getServer(id);
  }

  /** Removes a server. Servers with history are soft-deleted so reports stay intact. */
  async deleteServer(id: string, actor: ActorContext): Promise<void> {
    const server = await this.db.vPNServer.findFirst({ where: { id, deletedAt: null } });
    if (!server) throw notFound('Server');
    const history = await this.db.vPNConnection.count({ where: { serverId: id } });
    if (history === 0) {
      await this.db.vPNServer.delete({ where: { id } });
    } else {
      await this.db.$transaction(async (tx) => {
        await tx.vPNPeer.deleteMany({ where: { serverId: id } });
        await tx.vPNNode.deleteMany({ where: { serverId: id } });
        await tx.vPNServer.update({
          where: { id },
          data: {
            status: 'DISABLED',
            deletedAt: this.clock.now(),
            name: `${server.name}-DEL-${Date.now().toString(36)}`.slice(0, 32),
            hostname: `deleted-${id}.invalid`,
            enrollmentTokenHash: null,
            peerRevision: { increment: 1 },
          },
        });
      });
    }
    this.catalog.invalidate();
    await writeAuditLog(this.db, { ...actor, action: 'server.delete', targetType: 'server', targetId: id, metadata: { name: server.name } });
  }

  async createEnrollmentToken(id: string, actor: ActorContext): Promise<EnrollmentTokenDto> {
    const server = await this.db.vPNServer.findFirst({ where: { id, deletedAt: null } });
    if (!server) throw notFound('Server');
    const token = generatePrefixedToken('sne', 32);
    const expiresAt = new Date(this.clock.now().getTime() + this.env.NODE_ENROLLMENT_TTL_HOURS * 3600_000);
    await this.db.vPNServer.update({ where: { id }, data: { enrollmentTokenHash: sha256Hex(token), enrollmentExpiresAt: expiresAt } });
    await writeAuditLog(this.db, { ...actor, action: 'server.enrollment_token', targetType: 'server', targetId: id });
    const apiUrl = new URL(this.env.APP_URL).origin;
    return {
      serverId: id,
      enrollmentToken: token,
      expiresAt: expiresAt.toISOString(),
      installCommand: `sudo STORMVPN_API_URL=${apiUrl} STORMVPN_ENROLLMENT_TOKEN=${token} bash install-node.sh`,
    };
  }

  // ── Nodes ────────────────────────────────────────────────

  async listNodes(): Promise<AdminNodeDto[]> {
    const nodes = await this.db.vPNNode.findMany({
      include: { server: { select: { name: true, peerRevision: true } } },
      orderBy: { server: { name: 'asc' } },
    });
    return nodes.map((node) => toAdminNodeDto(node, node.server));
  }

  async nodeDetail(id: string) {
    const node = await this.db.vPNNode.findUnique({
      where: { id },
      include: { server: { select: { name: true, peerRevision: true } } },
    });
    if (!node) throw notFound('Node');
    const history = await this.db.nodeHeartbeat.findMany({
      where: { nodeId: id, createdAt: { gte: new Date(this.clock.now().getTime() - 24 * 3600_000) } },
      orderBy: { createdAt: 'asc' },
      take: 1440,
    });
    return {
      node: toAdminNodeDto(node, node.server),
      history: history.map((sample) => ({
        at: sample.createdAt.toISOString(),
        cpuPercent: sample.cpuPercent,
        memoryPercent: sample.memoryPercent,
        loadPercent: sample.loadPercent,
        activeConnections: sample.activeConnections,
        rxBps: toNumber(sample.rxBps),
        txBps: toNumber(sample.txBps),
      })),
    };
  }

  /** Deregisters a node (its token stops working). A new enrollment is required. */
  async deleteNode(id: string, actor: ActorContext): Promise<void> {
    const node = await this.db.vPNNode.findUnique({ where: { id } });
    if (!node) throw notFound('Node');
    await this.db.vPNNode.delete({ where: { id } });
    this.catalog.invalidate();
    await writeAuditLog(this.db, { ...actor, action: 'node.deregister', targetType: 'node', targetId: id, metadata: { serverId: node.serverId } });
  }

  // ── Connections & traffic ───────────────────────────────

  async listConnections(query: { page: number; pageSize: number; status?: string; serverId?: string; userId?: string }): Promise<Paginated<AdminConnectionDto>> {
    const where: Prisma.VPNConnectionWhereInput = {
      ...(query.status ? { status: query.status as never } : { status: { in: ['CONNECTING', 'CONNECTED'] } }),
      ...(query.serverId ? { serverId: query.serverId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.vPNConnection.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        ...pageArgs(query),
        include: { user: { select: { email: true } }, server: { select: { name: true } }, device: { select: { name: true } } },
      }),
      this.db.vPNConnection.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: row.user.email,
        serverId: row.serverId,
        serverName: row.server.name,
        deviceName: row.device?.name ?? null,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        connectedAt: row.connectedAt?.toISOString() ?? null,
        lastHandshakeAt: row.lastHandshakeAt?.toISOString() ?? null,
        rxBytes: toNumber(row.rxBytes),
        txBytes: toNumber(row.txBytes),
      })),
      total,
      query,
    );
  }

  async terminateConnection(id: string, actor: ActorContext): Promise<void> {
    await this.connections.disconnect(null, id, 'admin_terminated');
    await writeAuditLog(this.db, { ...actor, action: 'connection.terminate', targetType: 'connection', targetId: id });
  }

  async traffic(fromInput?: Date, toInput?: Date): Promise<AdminTrafficDto> {
    const to = startOfUtcDay(toInput ?? this.clock.now());
    const from = startOfUtcDay(fromInput ?? addDays(to, -29));
    const where = { day: { gte: from, lte: to } };
    const [daily, byServer, topUsers, servers] = await Promise.all([
      this.db.trafficUsage.groupBy({ by: ['day'], where, _sum: { rxBytes: true, txBytes: true }, orderBy: { day: 'asc' } }),
      this.db.trafficUsage.groupBy({ by: ['serverId'], where, _sum: { rxBytes: true, txBytes: true } }),
      this.db.trafficUsage.groupBy({
        by: ['userId'],
        where,
        _sum: { rxBytes: true, txBytes: true },
        orderBy: { _sum: { txBytes: 'desc' } },
        take: 10,
      }),
      this.db.vPNServer.findMany({ select: { id: true, name: true } }),
    ]);
    const serverNames = new Map(servers.map((server) => [server.id, server.name]));
    const users = await this.db.user.findMany({ where: { id: { in: topUsers.map((row) => row.userId) } }, select: { id: true, email: true } });
    const emails = new Map(users.map((user) => [user.id, user.email]));
    const dailyMap = new Map(daily.map((row) => [isoDay(row.day), row._sum]));
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalRxBytes: byServer.reduce((sum, row) => sum + toNumber(row._sum.rxBytes), 0),
      totalTxBytes: byServer.reduce((sum, row) => sum + toNumber(row._sum.txBytes), 0),
      daily: Array.from({ length: days }, (_, index) => {
        const date = isoDay(addDays(from, index));
        const sum = dailyMap.get(date);
        return { date, rxBytes: toNumber(sum?.rxBytes), txBytes: toNumber(sum?.txBytes) };
      }),
      byServer: byServer
        .map((row) => ({
          serverId: row.serverId,
          serverName: serverNames.get(row.serverId) ?? row.serverId,
          rxBytes: toNumber(row._sum.rxBytes),
          txBytes: toNumber(row._sum.txBytes),
        }))
        .sort((a, b) => b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes)),
      topUsers: topUsers.map((row) => ({
        userId: row.userId,
        email: emails.get(row.userId) ?? 'deleted',
        rxBytes: toNumber(row._sum.rxBytes),
        txBytes: toNumber(row._sum.txBytes),
      })),
    };
  }
}
