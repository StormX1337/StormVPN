import { ensureFreeSubscription, isLiveStatus, reconcileUserPeers } from '@stormvpn/core';
import type { Database, SubscriptionStatus } from '@stormvpn/database';
import type { Logger } from '@stormvpn/config';
import type { Clock } from '../../lib/clock';
import type { NormalizedSubscription, StripeGateway } from './stripe.gateway';

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  unpaid: 'UNPAID',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'INCOMPLETE_EXPIRED',
  paused: 'PAUSED',
};

export class UnresolvableSubscriptionError extends Error {}

/**
 * Mirrors a Stripe subscription into PostgreSQL. It always re-reads the
 * subscription from Stripe, which makes webhook processing order-independent.
 */
export class SubscriptionSyncService {
  constructor(
    private readonly db: Database,
    private readonly gateway: StripeGateway,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async syncById(stripeSubscriptionId: string, hint?: { userId?: string | null }): Promise<string | null> {
    const remote = await this.gateway.retrieveSubscription(stripeSubscriptionId);
    return this.apply(remote, hint);
  }

  private async resolveUser(remote: NormalizedSubscription, hintUserId?: string | null) {
    const byCustomer = await this.db.user.findUnique({ where: { stripeCustomerId: remote.customerId } });
    if (byCustomer) return byCustomer;
    const userId = hintUserId ?? remote.metadata.userId;
    if (!userId) return null;
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (user && !user.stripeCustomerId) {
      return this.db.user.update({ where: { id: user.id }, data: { stripeCustomerId: remote.customerId } });
    }
    return user?.stripeCustomerId === remote.customerId ? user : null;
  }

  private async resolvePlan(remote: NormalizedSubscription) {
    if (remote.priceId) {
      const byPrice = await this.db.plan.findUnique({ where: { stripePriceId: remote.priceId } });
      if (byPrice) return byPrice;
      // Grandfathered prices: the price was replaced but existing subscribers keep it.
      const existing = await this.db.subscription.findFirst({
        where: { stripePriceId: remote.priceId },
        select: { plan: true },
      });
      if (existing) return existing.plan;
    }
    return remote.metadata.planId ? this.db.plan.findUnique({ where: { id: remote.metadata.planId } }) : null;
  }

  async apply(remote: NormalizedSubscription, hint?: { userId?: string | null }): Promise<string | null> {
    const user = await this.resolveUser(remote, hint?.userId);
    const plan = await this.resolvePlan(remote);
    if (!user || !plan) {
      throw new UnresolvableSubscriptionError(
        `Cannot map Stripe subscription ${remote.id} (user ${user ? 'ok' : 'missing'}, plan ${plan ? 'ok' : 'missing'})`,
      );
    }
    const status = STATUS_MAP[remote.status] ?? 'INCOMPLETE';
    const now = this.clock.now();
    const data = {
      userId: user.id,
      planId: plan.id,
      status,
      provider: 'STRIPE' as const,
      stripePriceId: remote.priceId,
      currentPeriodStart: remote.currentPeriodStart,
      currentPeriodEnd: remote.currentPeriodEnd,
      cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
      canceledAt: remote.canceledAt,
      endedAt: remote.endedAt,
      trialStart: remote.trialStart,
      trialEnd: remote.trialEnd,
      couponId: remote.metadata.couponId ?? null,
      paymentMethodBrand: remote.paymentMethod?.brand ?? null,
      paymentMethodLast4: remote.paymentMethod?.last4 ?? null,
      paymentMethodExpMonth: remote.paymentMethod?.expMonth ?? null,
      paymentMethodExpYear: remote.paymentMethod?.expYear ?? null,
      providerUpdatedAt: now,
    };

    const subscriptionId = await this.db.$transaction(async (tx) => {
      if (isLiveStatus(status)) {
        // Only one live subscription per user: end the free/complimentary one being replaced.
        await tx.subscription.updateMany({
          where: {
            userId: user.id,
            status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
            // NULL-safe: free/complimentary subscriptions have no Stripe id.
            OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: { not: remote.id } }],
          },
          data: { status: 'CANCELED', endedAt: now, canceledAt: now },
        });
      }
      const existing = await tx.subscription.findUnique({ where: { stripeSubscriptionId: remote.id } });
      const saved = existing
        ? await tx.subscription.update({ where: { id: existing.id }, data })
        : await tx.subscription.create({ data: { ...data, stripeSubscriptionId: remote.id } });

      if (status === 'TRIALING' && !user.trialUsedAt) {
        await tx.user.update({ where: { id: user.id }, data: { trialUsedAt: now } });
      }
      if (!existing && data.couponId) {
        const redeemed = await tx.couponRedemption.findUnique({
          where: { couponId_userId: { couponId: data.couponId, userId: user.id } },
        });
        if (!redeemed) {
          await tx.couponRedemption.create({ data: { couponId: data.couponId, userId: user.id } });
          await tx.coupon.update({ where: { id: data.couponId }, data: { timesRedeemed: { increment: 1 } } });
        }
      }
      return saved.id;
    });

    if (!isLiveStatus(status)) await ensureFreeSubscription(this.db, user.id);
    const result = await reconcileUserPeers(this.db, user.id, now);
    this.logger.info({ userId: user.id, stripeSubscriptionId: remote.id, status, peers: result }, 'subscription synchronised');
    return subscriptionId;
  }
}
