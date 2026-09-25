import { toNumber } from '@stormvpn/database';
import { countryName } from '@stormvpn/types';
import type { JobContext, JobResult } from './context';
import { nowOf } from './context';

/**
 * Closes connections whose WireGuard handshake went stale. With a 25 s keepalive
 * WireGuard re-handshakes at least every ~2 minutes, so 5 minutes of silence
 * means the tunnel is gone.
 */
export async function runConnectionReaper(ctx: JobContext): Promise<JobResult> {
  const now = nowOf(ctx);
  const cutoff = new Date(now.getTime() - ctx.config.connectionStaleAfterSeconds * 1000);

  const idle = await ctx.db.vPNConnection.findMany({
    where: {
      OR: [
        { status: 'CONNECTED', OR: [{ lastHandshakeAt: null }, { lastHandshakeAt: { lt: cutoff } }] },
        { status: 'CONNECTING', startedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      userId: true,
      status: true,
      source: true,
      deviceId: true,
      startedAt: true,
      connectedAt: true,
      lastHandshakeAt: true,
      rxBytes: true,
      txBytes: true,
      device: { select: { name: true } },
      peer: { select: { ipv4Address: true } },
      server: { select: { id: true, name: true, countryCode: true, city: true, publicIpv4: true } },
    },
    take: 5_000,
  });
  if (idle.length === 0) return { closed: 0, failed: 0 };

  const connectedIds = idle.filter((c) => c.status === 'CONNECTED').map((c) => c.id);
  const connectingIds = idle.filter((c) => c.status === 'CONNECTING').map((c) => c.id);
  await ctx.db.vPNConnection.updateMany({
    where: { id: { in: connectedIds } },
    data: { status: 'DISCONNECTED', endedAt: now, disconnectReason: 'idle_timeout' },
  });
  await ctx.db.vPNConnection.updateMany({
    where: { id: { in: connectingIds } },
    data: { status: 'FAILED', endedAt: now, disconnectReason: 'no_handshake' },
  });

  if (ctx.events) {
    for (const connection of idle) {
      const status = connection.status === 'CONNECTED' ? 'DISCONNECTED' : 'FAILED';
      await ctx.events.toUser(connection.userId, {
        type: 'connection.updated',
        data: {
          id: connection.id,
          status,
          source: connection.source,
          server: {
            id: connection.server.id,
            name: connection.server.name,
            countryCode: connection.server.countryCode,
            countryName: countryName(connection.server.countryCode),
            city: connection.server.city,
            publicIpv4: connection.server.publicIpv4,
          },
          deviceId: connection.deviceId,
          deviceName: connection.device?.name ?? null,
          assignedIpv4: connection.peer?.ipv4Address ?? null,
          startedAt: connection.startedAt.toISOString(),
          connectedAt: connection.connectedAt?.toISOString() ?? null,
          endedAt: now.toISOString(),
          lastHandshakeAt: connection.lastHandshakeAt?.toISOString() ?? null,
          rxBytes: toNumber(connection.rxBytes),
          txBytes: toNumber(connection.txBytes),
          disconnectReason: status === 'FAILED' ? 'no_handshake' : 'idle_timeout',
        },
      });
    }
  }
  return { closed: connectedIds.length, failed: connectingIds.length };
}
