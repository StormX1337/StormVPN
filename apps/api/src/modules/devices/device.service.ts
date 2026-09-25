import { bumpPeerRevision, getEntitlements, recordSecurityEvent } from '@stormvpn/core';
import type { Database } from '@stormvpn/database';
import type { DeviceDto, PeerDto } from '@stormvpn/types';
import type { CreateDeviceInput } from '@stormvpn/validation';
import type { Clock } from '../../lib/clock';
import { forbidden, notFound, paymentRequired } from '../../lib/errors';
import { toPeerDto } from '../wireguard/peer.mapper';
import type { PeerService } from '../wireguard/peer.service';

export class DeviceService {
  constructor(
    private readonly db: Database,
    private readonly peers: PeerService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string): Promise<DeviceDto[]> {
    const devices = await this.db.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { peers: { where: { status: 'ACTIVE' } } } },
        connections: { where: { status: 'CONNECTED' }, select: { id: true }, take: 1 },
      },
    });
    return devices.map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      clientVersion: device.clientVersion,
      createdAt: device.createdAt.toISOString(),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      activePeers: device._count.peers,
      connected: device.connections.length > 0,
    }));
  }

  async create(userId: string, input: CreateDeviceInput, ipAddress: string): Promise<DeviceDto> {
    const entitlements = await getEntitlements(this.db, userId);
    if (!entitlements) throw paymentRequired('subscription_required', 'An active subscription is required');
    const count = await this.db.device.count({ where: { userId } });
    if (count >= entitlements.maxDevices) {
      await recordSecurityEvent(this.db, {
        userId,
        type: 'DEVICE_LIMIT_REACHED',
        ipAddress,
        metadata: { limit: entitlements.maxDevices },
      });
      throw forbidden('device_limit_reached', `Your plan allows ${entitlements.maxDevices} device(s). Remove one or upgrade.`);
    }
    const device = await this.db.device.create({
      data: { userId, name: input.name, platform: input.platform, clientVersion: input.clientVersion ?? null },
    });
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      clientVersion: device.clientVersion,
      createdAt: device.createdAt.toISOString(),
      lastSeenAt: null,
      activePeers: 0,
      connected: false,
    };
  }

  async rename(userId: string, deviceId: string, name: string): Promise<void> {
    const result = await this.db.device.updateMany({ where: { id: deviceId, userId }, data: { name } });
    if (result.count === 0) throw notFound('Device');
  }

  /** Removing a device revokes all of its WireGuard peers on every node. */
  async remove(userId: string, deviceId: string): Promise<void> {
    const device = await this.db.device.findFirst({
      where: { id: deviceId, userId },
      include: { peers: { select: { serverId: true } } },
    });
    if (!device) throw notFound('Device');
    await this.db.$transaction(async (tx) => {
      await tx.vPNConnection.updateMany({
        where: { deviceId, status: { in: ['CONNECTING', 'CONNECTED'] } },
        data: { status: 'DISCONNECTED', endedAt: this.clock.now(), disconnectReason: 'device_removed' },
      });
      await tx.device.delete({ where: { id: deviceId } });
      await bumpPeerRevision(tx, device.peers.map((peer) => peer.serverId));
    });
  }

  async listPeers(userId: string, deviceId: string): Promise<PeerDto[]> {
    const device = await this.db.device.findFirst({ where: { id: deviceId, userId }, select: { id: true } });
    if (!device) throw notFound('Device');
    const peers = await this.db.vPNPeer.findMany({
      where: { deviceId },
      include: { server: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return peers.map((peer) => toPeerDto(peer, peer.server.name));
  }

  async revokePeer(userId: string, deviceId: string, peerId: string): Promise<void> {
    const peer = await this.db.vPNPeer.findFirst({ where: { id: peerId, deviceId, userId } });
    if (!peer) throw notFound('Peer');
    await this.peers.revoke(peerId, userId);
  }
}
