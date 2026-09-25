import {
  getLiveSubscription,
  getMonthlyTrafficBytes,
  startOfUtcMonth,
  writeAuditLog,
} from '@stormvpn/core';
import { type Database, toNumber } from '@stormvpn/database';
import type { InvoiceDto, PlanDto, SubscriptionOverviewDto } from '@stormvpn/types';
import type { CheckoutInput } from '@stormvpn/validation';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from '../../lib/errors';
import type { AccountDeletionHook } from '../account/account.service';
import { toPlanDto } from '../subscriptions/plan.mapper';
import { toSubscriptionDto } from '../subscriptions/subscription.mapper';
import type { StripeCatalogService } from './catalog.service';
import type { CouponService } from './coupon.service';
import type { StripeGateway } from './stripe.gateway';
import type { SubscriptionSyncService } from './subscription-sync.service';

export class BillingService implements AccountDeletionHook {
  constructor(
    private readonly db: Database,
    private readonly gateway: StripeGateway | null,
    private readonly catalog: StripeCatalogService,
    private readonly coupons: CouponService,
    private readonly sync: SubscriptionSyncService | null,
    private readonly env: Pick<ApiEnv, 'APP_URL' | 'REQUIRE_EMAIL_VERIFICATION'>,
    private readonly clock: Clock,
  ) {}

  private requireGateway(): StripeGateway {
    if (!this.gateway) throw serviceUnavailable('billing_unavailable', 'Online payments are not configured');
    return this.gateway;
  }

  async listPlans(): Promise<PlanDto[]> {
    const plans = await this.db.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    });
    return plans.map(toPlanDto);
  }

  async overview(userId: string): Promise<SubscriptionOverviewDto> {
    const now = this.clock.now();
    const [subscription, user, devicesUsed, activeConnections, traffic] = await Promise.all([
      getLiveSubscription(this.db, userId),
      this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { trialUsedAt: true } }),
      this.db.device.count({ where: { userId } }),
      this.db.vPNConnection.count({ where: { userId, status: { in: ['CONNECTING', 'CONNECTED'] } } }),
      getMonthlyTrafficBytes(this.db, userId, now),
    ]);
    return {
      subscription: subscription ? toSubscriptionDto(subscription) : null,
      usage: {
        devicesUsed,
        activeConnections,
        trafficUsedBytes: toNumber(traffic),
        periodStart: startOfUtcMonth(now).toISOString(),
      },
      trialEligible: user.trialUsedAt === null,
    };
  }

  async checkout(userId: string, input: CheckoutInput): Promise<{ url: string }> {
    const gateway = this.requireGateway();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (this.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
      throw forbidden('email_not_verified', 'Please verify your email address first');
    }
    let plan = await this.db.plan.findFirst({ where: { id: input.planId, isActive: true } });
    if (!plan) throw notFound('Plan');
    if (plan.priceCents === 0) throw badRequest('free_plan', 'The free plan does not require checkout');

    const live = await getLiveSubscription(this.db, userId);
    if (live?.provider === 'STRIPE') {
      throw conflict('subscription_exists', 'You already have a paid subscription – change your plan instead');
    }
    plan = await this.catalog.syncPlan(plan);
    const coupon = input.couponCode ? await this.coupons.validate(input.couponCode, userId, plan.id) : null;
    const syncedCoupon = coupon ? await this.catalog.syncCoupon(coupon) : null;

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      customerId = await gateway.createCustomer({ email: user.email, name: user.name, userId });
      await this.db.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }
    const hadTrial = user.trialUsedAt !== null || (await this.db.subscription.count({ where: { userId, provider: 'STRIPE' } })) > 0;
    const minute = Math.floor(this.clock.now().getTime() / 60_000);
    const session = await gateway.createCheckoutSession({
      customerId,
      priceId: plan.stripePriceId!,
      userId,
      planId: plan.id,
      trialDays: !hadTrial && plan.trialDays > 0 ? plan.trialDays : null,
      stripeCouponId: syncedCoupon?.stripeCouponId ?? null,
      couponId: syncedCoupon?.id ?? null,
      successUrl: `${this.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${this.env.APP_URL}/subscription?checkout=canceled`,
      idempotencyKey: `checkout-${userId}-${plan.id}-${syncedCoupon?.id ?? 'none'}-${minute}`,
    });
    return { url: session.url };
  }

  async portal(userId: string): Promise<{ url: string }> {
    const gateway = this.requireGateway();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.stripeCustomerId) throw badRequest('no_billing_account', 'No billing account exists yet');
    return { url: await gateway.createPortalSession(user.stripeCustomerId, `${this.env.APP_URL}/subscription`) };
  }

  private async liveStripeSubscription(userId: string) {
    const live = await getLiveSubscription(this.db, userId);
    if (!live || live.provider !== 'STRIPE' || !live.stripeSubscriptionId) {
      throw badRequest('no_paid_subscription', 'You do not have a paid subscription');
    }
    return live;
  }

  /** Upgrade/downgrade with Stripe proration. Switching to a free plan cancels at period end. */
  async changePlan(userId: string, planId: string): Promise<SubscriptionOverviewDto> {
    const gateway = this.requireGateway();
    const live = await this.liveStripeSubscription(userId);
    let plan = await this.db.plan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw notFound('Plan');
    if (plan.id === live.planId) throw badRequest('same_plan', 'You are already on this plan');
    if (plan.priceCents === 0) {
      await gateway.setCancelAtPeriodEnd(live.stripeSubscriptionId!, true);
    } else {
      plan = await this.catalog.syncPlan(plan);
      await gateway.changeSubscriptionPrice(live.stripeSubscriptionId!, plan.stripePriceId!);
    }
    await this.sync?.syncById(live.stripeSubscriptionId!);
    await writeAuditLog(this.db, {
      actorId: userId,
      actorType: 'USER',
      action: 'subscription.change_plan',
      targetType: 'subscription',
      targetId: live.id,
      metadata: { from: live.planId, to: plan.id },
    });
    return this.overview(userId);
  }

  async setCancellation(userId: string, cancel: boolean): Promise<SubscriptionOverviewDto> {
    const gateway = this.requireGateway();
    const live = await this.liveStripeSubscription(userId);
    await gateway.setCancelAtPeriodEnd(live.stripeSubscriptionId!, cancel);
    await this.sync?.syncById(live.stripeSubscriptionId!);
    await writeAuditLog(this.db, {
      actorId: userId,
      actorType: 'USER',
      action: cancel ? 'subscription.cancel' : 'subscription.resume',
      targetType: 'subscription',
      targetId: live.id,
    });
    return this.overview(userId);
  }

  async invoices(userId: string): Promise<InvoiceDto[]> {
    const invoices = await this.db.invoice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amountDueCents: invoice.amountDueCents,
      amountPaidCents: invoice.amountPaidCents,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      invoicePdfUrl: invoice.invoicePdfUrl,
      periodStart: invoice.periodStart?.toISOString() ?? null,
      periodEnd: invoice.periodEnd?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    }));
  }

  async beforeAccountDeletion(userId: string): Promise<void> {
    if (!this.gateway) return;
    const subscriptions = await this.db.subscription.findMany({
      where: { userId, provider: 'STRIPE', status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    });
    for (const subscription of subscriptions) {
      if (subscription.stripeSubscriptionId) await this.gateway.cancelSubscriptionNow(subscription.stripeSubscriptionId);
    }
  }
}
