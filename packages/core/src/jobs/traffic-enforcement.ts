import { reconcileUserPeers } from '../peers';
import { recordSecurityEvent } from '../security-events';
import { startOfUtcMonth } from '../time';
import type { JobContext, JobResult } from './context';
import { nowOf } from './context';

interface UsageRow {
  userId: string;
  email: string;
  used: bigint;
  limit: bigint;
}

/**
 * Disables peers of users who exhausted their monthly allowance and re-enables
 * peers once a new month starts (or the user upgraded).
 */
export async function runTrafficEnforcement(ctx: JobContext): Promise<JobResult> {
  const now = nowOf(ctx);
  const monthStart = startOfUtcMonth(now);

  const exceeded = await ctx.db.$queryRaw<UsageRow[]>`
    SELECT u."id" AS "userId", u."email" AS "email",
           COALESCE(SUM(t."rxBytes" + t."txBytes"), 0)::bigint AS "used",
           p."trafficLimitBytes" AS "limit"
    FROM "subscriptions" s
    JOIN "plans" p ON p."id" = s."planId"
    JOIN "users" u ON u."id" = s."userId"
    JOIN "traffic_usage" t ON t."userId" = s."userId" AND t."day" >= ${monthStart}::date
    WHERE s."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
      AND p."trafficLimitBytes" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "vpn_peers" vp WHERE vp."userId" = s."userId" AND vp."status" = 'ACTIVE')
    GROUP BY u."id", u."email", p."trafficLimitBytes"
    HAVING COALESCE(SUM(t."rxBytes" + t."txBytes"), 0) >= p."trafficLimitBytes"
    LIMIT 1000`;

  let limited = 0;
  for (const row of exceeded) {
    const result = await reconcileUserPeers(ctx.db, row.userId, now);
    if (result.disabled === 0) continue;
    limited++;
    await recordSecurityEvent(ctx.db, {
      userId: row.userId,
      type: 'TRAFFIC_LIMIT_REACHED',
      metadata: { usedBytes: row.used.toString(), limitBytes: row.limit.toString() },
    });
    await ctx.mail?.send({
      template: 'traffic-limit-reached',
      to: row.email,
      data: { limitGb: Number(row.limit / 1024n ** 3n) },
    });
  }

  // Re-evaluate users whose peers were disabled for traffic (monthly reset / upgrades).
  const pending = await ctx.db.vPNPeer.findMany({
    where: { status: 'DISABLED', disabledReason: 'TRAFFIC_LIMIT' },
    distinct: ['userId'],
    select: { userId: true },
    take: 1000,
  });
  let restored = 0;
  for (const { userId } of pending) {
    const result = await reconcileUserPeers(ctx.db, userId, now);
    if (result.enabled > 0) restored++;
  }
  return { limited, restored };
}
