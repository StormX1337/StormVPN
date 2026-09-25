import { type EventPublisher, startOfUtcDay, uuidv7 } from '@stormvpn/core';
import type { Database } from '@stormvpn/database';
import type { AgentPeerStat } from '@stormvpn/validation';
import type { Clock } from '../../lib/clock';
import { connectionInclude, toConnectionDto } from '../connections/connection.mapper';

/** A handshake younger than this means the tunnel is up (WireGuard rekeys every 2 min). */
const HANDSHAKE_ALIVE_SECONDS = 180;
const MAX_COUNTER_DELTA = 10n * 1024n ** 4n; // 10 TiB per interval = obviously bogus

export interface TelemetryResult {
  activeConnections: number;
  connected: number;
  trafficRows: number;
}

/**
 * Ingests per-peer WireGuard statistics reported by a node:
 *  - updates peer handshake + byte counters,
 *  - aggregates daily traffic per user (volume only),
 *  - drives connection state (CONNECTING → CONNECTED, CONFIG sessions).
 * All writes are set-based SQL so thousands of peers per heartbeat stay cheap.
 */
export class TelemetryService {
  constructor(
    private readonly db: Database,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async ingest(serverId: string, stats: AgentPeerStat[]): Promise<TelemetryResult> {
    const now = this.clock.now();
    if (stats.length === 0) {
      return { activeConnections: await this.countActive(serverId), connected: 0, trafficRows: 0 };
    }
    const peers = await this.db.vPNPeer.findMany({
      where: { serverId, publicKey: { in: stats.map((stat) => stat.publicKey) } },
      select: { id: true, userId: true, deviceId: true, publicKey: true },
    });
    const byKey = new Map(peers.map((peer) => [peer.publicKey, peer]));

    const peerIds: string[] = [];
    const handshakes: (Date | null)[] = [];
    const rx: bigint[] = [];
    const tx: bigint[] = [];
    const trafficByUser = new Map<string, { rx: bigint; tx: bigint }>();
    const alive: { peerId: string; userId: string; deviceId: string; handshake: Date; rx: bigint; tx: bigint }[] = [];

    for (const stat of stats) {
      const peer = byKey.get(stat.publicKey);
      if (!peer) continue;
      const rxDelta = BigInt(Math.floor(stat.rxBytesDelta));
      const txDelta = BigInt(Math.floor(stat.txBytesDelta));
      if (rxDelta > MAX_COUNTER_DELTA || txDelta > MAX_COUNTER_DELTA) continue;
      const handshake = stat.latestHandshake > 0 ? new Date(stat.latestHandshake * 1000) : null;
      peerIds.push(peer.id);
      handshakes.push(handshake);
      rx.push(rxDelta);
      tx.push(txDelta);
      if (rxDelta > 0n || txDelta > 0n) {
        const total = trafficByUser.get(peer.userId) ?? { rx: 0n, tx: 0n };
        total.rx += rxDelta;
        total.tx += txDelta;
        trafficByUser.set(peer.userId, total);
      }
      if (handshake && now.getTime() - handshake.getTime() < HANDSHAKE_ALIVE_SECONDS * 1000) {
        alive.push({ peerId: peer.id, userId: peer.userId, deviceId: peer.deviceId, handshake, rx: rxDelta, tx: txDelta });
      }
    }
    if (peerIds.length === 0) {
      return { activeConnections: await this.countActive(serverId), connected: 0, trafficRows: 0 };
    }

    await this.db.$executeRaw`
      UPDATE "vpn_peers" AS p
      SET "lastHandshakeAt" = GREATEST(p."lastHandshakeAt", s.handshake),
          "rxBytes" = p."rxBytes" + s.rx,
          "txBytes" = p."txBytes" + s.tx,
          "updatedAt" = ${now}
      FROM unnest(${peerIds}::uuid[], ${handshakes}::timestamp[], ${rx}::bigint[], ${tx}::bigint[])
        AS s(id, handshake, rx, tx)
      WHERE p."id" = s.id`;

    const trafficRows = await this.recordTraffic(serverId, trafficByUser, now);
    const connected = await this.updateConnections(serverId, alive);
    return { activeConnections: await this.countActive(serverId), connected, trafficRows };
  }

  private async recordTraffic(serverId: string, totals: Map<string, { rx: bigint; tx: bigint }>, now: Date): Promise<number> {
    if (totals.size === 0) return 0;
    const day = startOfUtcDay(now);
    const users = [...totals.keys()];
    const ids = users.map(() => uuidv7(now.getTime()));
    const rx = users.map((user) => totals.get(user)!.rx);
    const tx = users.map((user) => totals.get(user)!.tx);
    return this.db.$executeRaw`
      INSERT INTO "traffic_usage" ("id", "userId", "serverId", "day", "rxBytes", "txBytes", "updatedAt")
      SELECT s.id, s.user_id, ${serverId}::uuid, ${day}::date, s.rx, s.tx, ${now}
      FROM unnest(${ids}::uuid[], ${users}::uuid[], ${rx}::bigint[], ${tx}::bigint[]) AS s(id, user_id, rx, tx)
      ON CONFLICT ("userId", "serverId", "day") DO UPDATE
      SET "rxBytes" = "traffic_usage"."rxBytes" + EXCLUDED."rxBytes",
          "txBytes" = "traffic_usage"."txBytes" + EXCLUDED."txBytes",
          "updatedAt" = EXCLUDED."updatedAt"`;
  }

  private async updateConnections(
    serverId: string,
    alive: { peerId: string; userId: string; deviceId: string; handshake: Date; rx: bigint; tx: bigint }[],
  ): Promise<number> {
    if (alive.length === 0) return 0;
    const peerIds = alive.map((entry) => entry.peerId);
    const live = await this.db.vPNConnection.findMany({
      where: { peerId: { in: peerIds }, status: { in: ['CONNECTING', 'CONNECTED'] } },
      select: { id: true, peerId: true, status: true, userId: true },
    });
    const liveByPeer = new Map(live.map((connection) => [connection.peerId!, connection]));

    // Update existing live connections in one statement.
    const existing = alive.filter((entry) => liveByPeer.has(entry.peerId));
    if (existing.length > 0) {
      await this.db.$executeRaw`
        UPDATE "vpn_connections" AS c
        SET "status" = 'CONNECTED',
            "connectedAt" = COALESCE(c."connectedAt", s.handshake),
            "lastHandshakeAt" = GREATEST(c."lastHandshakeAt", s.handshake),
            "rxBytes" = c."rxBytes" + s.rx,
            "txBytes" = c."txBytes" + s.tx
        FROM unnest(
          ${existing.map((entry) => liveByPeer.get(entry.peerId)!.id)}::uuid[],
          ${existing.map((entry) => entry.handshake)}::timestamp[],
          ${existing.map((entry) => entry.rx)}::bigint[],
          ${existing.map((entry) => entry.tx)}::bigint[]
        ) AS s(id, handshake, rx, tx)
        WHERE c."id" = s.id`;
    }

    // Tunnels brought up from a downloaded config file have no API session yet.
    const fresh = alive.filter((entry) => !liveByPeer.has(entry.peerId));
    if (fresh.length > 0) {
      await this.db.vPNConnection.createMany({
        data: fresh.map((entry) => ({
          userId: entry.userId,
          deviceId: entry.deviceId,
          peerId: entry.peerId,
          serverId,
          status: 'CONNECTED' as const,
          source: 'CONFIG' as const,
          startedAt: entry.handshake,
          connectedAt: entry.handshake,
          lastHandshakeAt: entry.handshake,
          rxBytes: entry.rx,
          txBytes: entry.tx,
        })),
      });
    }

    // Push state changes (newly connected sessions) to the owners' dashboards.
    const changed = [
      ...live.filter((connection) => connection.status === 'CONNECTING').map((connection) => connection.id),
    ];
    const changedRows = await this.db.vPNConnection.findMany({
      where: {
        OR: [
          { id: { in: changed } },
          { peerId: { in: fresh.map((entry) => entry.peerId) }, status: 'CONNECTED', source: 'CONFIG' },
        ],
      },
      include: connectionInclude,
    });
    for (const row of changedRows) {
      await this.events.toUser(row.userId, { type: 'connection.updated', data: toConnectionDto(row) });
    }
    return changedRows.length;
  }

  private countActive(serverId: string): Promise<number> {
    return this.db.vPNConnection.count({ where: { serverId, status: 'CONNECTED' } });
  }
}

