import type { JobContext, JobResult } from './context';
import { nowOf } from './context';

/** Marks nodes whose heartbeats stopped as OFFLINE and aligns maintenance state. */
export async function runNodeHealth(ctx: JobContext): Promise<JobResult> {
  const now = nowOf(ctx);
  const cutoff = new Date(now.getTime() - ctx.config.nodeOfflineAfterSeconds * 1000);

  const stale = await ctx.db.vPNNode.findMany({
    where: {
      status: { not: 'OFFLINE' },
      OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: cutoff } }],
    },
    select: { id: true, serverId: true, lastHeartbeatAt: true, server: { select: { name: true } } },
  });

  if (stale.length > 0) {
    await ctx.db.vPNNode.updateMany({
      where: { id: { in: stale.map((node) => node.id) } },
      data: { status: 'OFFLINE', activeConnections: 0, rxBps: 0n, txBps: 0n },
    });
    for (const node of stale) {
      ctx.logger.warn(
        { nodeId: node.id, server: node.server.name },
        'node marked offline (missed heartbeats)',
      );
      await ctx.events?.toAdmins({
        type: 'admin.node',
        data: {
          id: node.id,
          serverId: node.serverId,
          serverName: node.server.name,
          status: 'OFFLINE',
          lastHeartbeatAt: node.lastHeartbeatAt?.toISOString() ?? null,
          metrics: {
            cpuPercent: 0,
            memoryPercent: 0,
            diskPercent: 0,
            rxBps: 0,
            txBps: 0,
            bandwidthMbps: 0,
            activeConnections: 0,
            activePeers: 0,
            load: 0,
            uptimeSeconds: 0,
          },
        },
      });
    }
  }

  // Nodes of servers under maintenance report MAINTENANCE regardless of heartbeats.
  const maintenance = await ctx.db.vPNNode.updateMany({
    where: { status: { in: ['ONLINE', 'DEGRADED'] }, server: { status: 'MAINTENANCE' } },
    data: { status: 'MAINTENANCE' },
  });

  return { markedOffline: stale.length, markedMaintenance: maintenance.count };
}
