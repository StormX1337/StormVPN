import { type EventPublisher, recordSecurityEvent, type SettingsService } from '@stormvpn/core';
import type { Database } from '@stormvpn/database';
import type { ConnectionDto, ConnectResultDto, WireGuardConfigDto } from '@stormvpn/types';
import type { CreateConnectionInput, WireGuardConfigInput } from '@stormvpn/validation';
import type { Clock } from '../../lib/clock';
import type { RedisCounter } from '../../lib/counter';
import { conflict, notFound, tooManyRequests } from '../../lib/errors';
import type { ProviderRegistry } from '../providers/provider-registry';
import type { ServerSelectionService } from '../selection/selection.service';
import type { VpnAccessGuard } from './access-guard';
import { connectionInclude, toConnectionDto } from './connection.mapper';

const LIVE = ['CONNECTING', 'CONNECTED'] as const;

export interface RequestInfo {
  ipAddress: string;
  edgeCountry: string | null;
}

/**
 * Connection lifecycle:
 *   connect → (selection) → provider provisions peer → CONNECTING
 *   node reports handshake → CONNECTED
 *   user disconnect / idle reaper → DISCONNECTED
 */
export class ConnectionService {
  constructor(
    private readonly db: Database,
    private readonly access: VpnAccessGuard,
    private readonly selection: ServerSelectionService,
    private readonly providers: ProviderRegistry,
    private readonly settings: SettingsService,
    private readonly counter: RedisCounter,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  private async enforceConfigQuota(userId: string, info: RequestInfo): Promise<void> {
    const { maxConfigGenerationsPerHour } = await this.settings.get();
    const quota = await this.counter.hit(`wgcfg:${userId}`, maxConfigGenerationsPerHour, 3600);
    if (quota.exceeded) {
      if (quota.count === maxConfigGenerationsPerHour + 1) {
        await recordSecurityEvent(this.db, {
          userId,
          type: 'RATE_LIMITED',
          ipAddress: info.ipAddress,
          metadata: { scope: 'wireguard_config', limit: maxConfigGenerationsPerHour },
        });
      }
      throw tooManyRequests('config_quota_exceeded', 'Too many configurations generated, try again later', quota.ttlSeconds);
    }
  }

  async generateConfig(
    userId: string,
    input: WireGuardConfigInput,
    info: RequestInfo,
  ): Promise<WireGuardConfigDto & { selection: ConnectResultDto['selection'] }> {
    const { entitlements } = await this.access.check(userId, input.deviceId);
    await this.enforceConfigQuota(userId, info);
    const outcome = await this.selection.resolve(userId, entitlements, input, info.edgeCountry);
    const provisioned = await this.providers.get(outcome.server.provider).provision({
      userId,
      deviceId: input.deviceId,
      server: outcome.server,
      publicKey: input.publicKey,
      allowedIps: input.allowedIps,
    });
    await this.db.device.update({ where: { id: input.deviceId }, data: { lastSeenAt: this.clock.now() } });
    return {
      ...provisioned.wireguard,
      selection: { strategy: outcome.strategy, score: outcome.score, reason: outcome.reason },
    };
  }

  async connect(userId: string, input: CreateConnectionInput, info: RequestInfo): Promise<ConnectResultDto> {
    const { entitlements } = await this.access.check(userId, input.deviceId);

    // Reconnecting / switching server on the same device ends its previous session.
    await this.db.vPNConnection.updateMany({
      where: { userId, deviceId: input.deviceId, status: { in: [...LIVE] } },
      data: { status: 'DISCONNECTED', endedAt: this.clock.now(), disconnectReason: 'replaced' },
    });
    const active = await this.db.vPNConnection.count({ where: { userId, status: { in: [...LIVE] } } });
    if (active >= entitlements.maxSessions) {
      await recordSecurityEvent(this.db, {
        userId,
        type: 'CONNECTION_LIMIT_REACHED',
        ipAddress: info.ipAddress,
        metadata: { active, limit: entitlements.maxSessions },
      });
      throw conflict('connection_limit_reached', `Your plan allows ${entitlements.maxSessions} simultaneous connection(s)`);
    }
    await this.enforceConfigQuota(userId, info);

    const outcome = await this.selection.resolve(userId, entitlements, input, info.edgeCountry);
    const provisioned = await this.providers.get(outcome.server.provider).provision({
      userId,
      deviceId: input.deviceId,
      server: outcome.server,
      publicKey: input.publicKey,
      allowedIps: input.allowedIps,
    });

    const connection = await this.db.vPNConnection.create({
      data: {
        userId,
        deviceId: input.deviceId,
        peerId: provisioned.peerId,
        serverId: outcome.server.id,
        status: 'CONNECTING',
        source: 'API',
      },
      include: connectionInclude,
    });
    await this.db.device.update({ where: { id: input.deviceId }, data: { lastSeenAt: this.clock.now() } });
    const dto = toConnectionDto(connection);
    await this.events.toUser(userId, { type: 'connection.updated', data: dto });
    return {
      connection: dto,
      wireguard: provisioned.wireguard,
      selection: { strategy: outcome.strategy, score: outcome.score, reason: outcome.reason },
    };
  }

  async disconnect(userId: string | null, connectionId: string, reason: string): Promise<ConnectionDto> {
    const connection = await this.db.vPNConnection.findFirst({
      where: { id: connectionId, ...(userId ? { userId } : {}) },
    });
    if (!connection) throw notFound('Connection');
    const updated = await this.db.vPNConnection.update({
      where: { id: connectionId },
      data: LIVE.includes(connection.status as (typeof LIVE)[number])
        ? { status: 'DISCONNECTED', endedAt: this.clock.now(), disconnectReason: reason }
        : {},
      include: connectionInclude,
    });
    const dto = toConnectionDto(updated);
    await this.events.toUser(connection.userId, { type: 'connection.updated', data: dto });
    return dto;
  }

  async current(userId: string): Promise<ConnectionDto | null> {
    const connection = await this.db.vPNConnection.findFirst({
      where: { userId, status: { in: [...LIVE] } },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      include: connectionInclude,
    });
    return connection ? toConnectionDto(connection) : null;
  }

  async active(userId: string): Promise<ConnectionDto[]> {
    const connections = await this.db.vPNConnection.findMany({
      where: { userId, status: { in: [...LIVE] } },
      orderBy: { startedAt: 'desc' },
      include: connectionInclude,
    });
    return connections.map(toConnectionDto);
  }

  async history(userId: string, limit: number): Promise<ConnectionDto[]> {
    const connections = await this.db.vPNConnection.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: connectionInclude,
    });
    return connections.map(toConnectionDto);
  }
}
