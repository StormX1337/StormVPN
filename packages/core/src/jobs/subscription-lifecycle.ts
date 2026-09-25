import { ensureFreeSubscription } from '../entitlements';
import { reconcileUserPeers } from '../peers';
import type { JobContext, JobResult } from './context';
import { nowOf } from './context';

/**
 * Expires non-Stripe (free/complimentary) subscriptions whose period ended,
 * falls users back to the free plan and enforces the resulting entitlements.
 * Stripe subscriptions are driven by webhooks.
 */
export async function runSubscriptionLifecycle(ctx: JobContext): Promise<JobResult> {
  const now = nowOf(ctx);
  const expired = await ctx.db.subscription.findMany({
    where: {
      provider: 'NONE',
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      currentPeriodEnd: { lt: now },
    },
    select: { id: true, userId: true, plan: { select: { priceCents: true } } },
    take: 1000,
  });

  const affectedUsers = new Set<string>();
  for (const subscription of expired) {
    await ctx.db.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELED', endedAt: now, canceledAt: now },
    });
    affectedUsers.add(subscription.userId);
  }

  // Users that ended up without any live subscription (e.g. Stripe cancellation) get the free plan.
  const orphaned = await ctx.db.user.findMany({
    where: {
      deletedAt: null,
      subscriptions: { none: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } },
    },
    select: { id: true },
    take: 1000,
  });
  for (const user of orphaned) affectedUsers.add(user.id);

  let downgraded = 0;
  for (const userId of affectedUsers) {
    const subscription = await ensureFreeSubscription(ctx.db, userId);
    if (subscription) downgraded++;
    await reconcileUserPeers(ctx.db, userId, now);
  }
  return { expired: expired.length, downgraded };
}
