import { DAY } from '../time';
import type { JobContext, JobResult } from './context';
import { nowOf } from './context';

/** Data retention: removes expired credentials and prunes time series / logs. */
export async function runCleanup(ctx: JobContext): Promise<JobResult> {
  const now = nowOf(ctx).getTime();
  const { config } = ctx;

  const sessions = await ctx.db.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date(now) } }, { revokedAt: { lt: new Date(now - 30 * DAY) } }],
    },
  });
  const tokens = await ctx.db.verificationToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date(now - DAY) } }, { usedAt: { lt: new Date(now - DAY) } }],
    },
  });
  const heartbeats = await ctx.db.nodeHeartbeat.deleteMany({
    where: { createdAt: { lt: new Date(now - config.heartbeatRetentionDays * DAY) } },
  });
  const connections = await ctx.db.vPNConnection.deleteMany({
    where: {
      status: { in: ['DISCONNECTED', 'FAILED'] },
      endedAt: { lt: new Date(now - config.connectionRetentionDays * DAY) },
    },
  });
  const webhooks = await ctx.db.webhookEvent.deleteMany({
    where: { status: 'PROCESSED', processedAt: { lt: new Date(now - 90 * DAY) } },
  });
  const audit = await ctx.db.auditLog.deleteMany({
    where: { createdAt: { lt: new Date(now - config.auditRetentionDays * DAY) } },
  });
  const riskFlags = await ctx.db.riskFlag.updateMany({
    where: { resolvedAt: null, expiresAt: { lt: new Date(now) } },
    data: { resolvedAt: new Date(now) },
  });
  const expiredEnrollments = await ctx.db.vPNServer.updateMany({
    where: { enrollmentExpiresAt: { lt: new Date(now) }, enrollmentTokenHash: { not: null } },
    data: { enrollmentTokenHash: null, enrollmentExpiresAt: null },
  });

  return {
    sessions: sessions.count,
    tokens: tokens.count,
    heartbeats: heartbeats.count,
    connections: connections.count,
    webhooks: webhooks.count,
    audit: audit.count,
    riskFlagsExpired: riskFlags.count,
    enrollmentsExpired: expiredEnrollments.count,
  };
}
