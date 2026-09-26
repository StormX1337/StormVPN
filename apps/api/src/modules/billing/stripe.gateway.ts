import Stripe from 'stripe';
import type { BillingInterval, CouponDuration } from '@stormvpn/database';

export interface NormalizedSubscription {
  id: string;
  customerId: string;
  status: string;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  metadata: Record<string, string>;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number | null;
    expYear: number | null;
  } | null;
}

export interface NormalizedInvoice {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  failureMessage: string | null;
}

export interface GatewayEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export interface CheckoutParams {
  customerId: string;
  priceId: string;
  userId: string;
  planId: string;
  trialDays: number | null;
  stripeCouponId: string | null;
  couponId: string | null;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface CreateCouponParams {
  code: string;
  name: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string | null;
  duration: CouponDuration;
  durationInMonths: number | null;
  maxRedemptions: number | null;
  redeemBy: Date | null;
}

/** Narrow billing port – the rest of the API never touches the Stripe SDK directly. */
export interface StripeGateway {
  createCustomer(params: { email: string; name: string | null; userId: string }): Promise<string>;
  createCheckoutSession(params: CheckoutParams): Promise<{ id: string; url: string }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<string>;
  retrieveSubscription(subscriptionId: string): Promise<NormalizedSubscription>;
  changeSubscriptionPrice(subscriptionId: string, priceId: string): Promise<void>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  cancelSubscriptionNow(subscriptionId: string): Promise<void>;
  constructEvent(payload: Buffer, signature: string): GatewayEvent;
  ensureProduct(params: {
    productId: string | null;
    name: string;
    description: string | null;
    planId: string;
  }): Promise<string>;
  createPrice(params: {
    productId: string;
    unitAmount: number;
    currency: string;
    interval: BillingInterval;
    intervalCount: number;
    planId: string;
  }): Promise<string>;
  archivePrice(priceId: string): Promise<void>;
  createCoupon(params: CreateCouponParams): Promise<{ couponId: string; promotionCodeId: string }>;
  setPromotionCodeActive(promotionCodeId: string, active: boolean): Promise<void>;
}

const toDate = (seconds: number | null | undefined): Date | null =>
  typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : null;

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === 'string' ? value : value.id;

/**
 * Normalises a subscription across Stripe API versions: since 2025-03-31
 * billing periods live on subscription items instead of the subscription.
 */
export function normalizeSubscription(subscription: Stripe.Subscription): NormalizedSubscription {
  const item = subscription.items?.data?.[0] as
    (Stripe.SubscriptionItem & Record<string, unknown>) | undefined;
  const legacy = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const pm = subscription.default_payment_method;
  const card = pm && typeof pm !== 'string' ? pm.card : null;
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer)!,
    status: subscription.status,
    priceId: item?.price?.id ?? null,
    currentPeriodStart: toDate(
      (item?.current_period_start as number | undefined) ?? legacy.current_period_start,
    ),
    currentPeriodEnd: toDate(
      (item?.current_period_end as number | undefined) ?? legacy.current_period_end,
    ),
    cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at !== null,
    canceledAt: toDate(subscription.canceled_at),
    endedAt: toDate(subscription.ended_at),
    trialStart: toDate(subscription.trial_start),
    trialEnd: toDate(subscription.trial_end),
    metadata: (subscription.metadata ?? {}) as Record<string, string>,
    paymentMethod: card
      ? {
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month ?? null,
          expYear: card.exp_year ?? null,
        }
      : null,
  };
}

/** Normalises an invoice (subscription reference moved to `parent.subscription_details` in newer API versions). */
export function normalizeInvoice(raw: Record<string, unknown>): NormalizedInvoice {
  const invoice = raw as unknown as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
  };
  const parentSubscription = invoice.parent?.subscription_details?.subscription;
  return {
    id: invoice.id!,
    customerId: idOf(invoice.customer as string | { id: string } | null),
    subscriptionId: idOf(parentSubscription ?? invoice.subscription ?? null),
    number: invoice.number ?? null,
    status: invoice.status ?? null,
    amountDue: invoice.amount_due ?? 0,
    amountPaid: invoice.amount_paid ?? 0,
    currency: invoice.currency ?? 'eur',
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
    periodStart: toDate(invoice.period_start),
    periodEnd: toDate(invoice.period_end),
    paidAt: toDate(invoice.status_transitions?.paid_at),
    failureMessage: invoice.last_finalization_error?.message ?? null,
  };
}

const INTERVALS: Record<BillingInterval, Stripe.PriceCreateParams.Recurring.Interval> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
};

export class StripeSdkGateway implements StripeGateway {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.stripe = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'StormVPN', version: '1.0.0' },
    });
  }

  async createCustomer(params: {
    email: string;
    name: string | null;
    userId: string;
  }): Promise<string> {
    const customer = await this.stripe.customers.create(
      { email: params.email, name: params.name ?? undefined, metadata: { userId: params.userId } },
      { idempotencyKey: `customer-${params.userId}` },
    );
    return customer.id;
  }

  async createCheckoutSession(params: CheckoutParams): Promise<{ id: string; url: string }> {
    const metadata = {
      userId: params.userId,
      planId: params.planId,
      ...(params.couponId ? { couponId: params.couponId } : {}),
    };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: params.customerId,
        client_reference_id: params.userId,
        line_items: [{ price: params.priceId, quantity: 1 }],
        subscription_data: {
          metadata,
          ...(params.trialDays ? { trial_period_days: params.trialDays } : {}),
        },
        ...(params.stripeCouponId
          ? { discounts: [{ coupon: params.stripeCouponId }] }
          : { allow_promotion_codes: true }),
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata,
      },
      { idempotencyKey: params.idempotencyKey },
    );
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  async retrieveSubscription(subscriptionId: string): Promise<NormalizedSubscription> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method'],
    });
    return normalizeSubscription(subscription);
  }

  async changeSubscriptionPrice(subscriptionId: string, priceId: string): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) throw new Error('Subscription has no items');
    await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void> {
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  }

  async cancelSubscriptionNow(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }

  constructEvent(payload: Buffer, signature: string): GatewayEvent {
    if (!this.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret,
    ) as unknown as GatewayEvent;
  }

  async ensureProduct(params: {
    productId: string | null;
    name: string;
    description: string | null;
    planId: string;
  }): Promise<string> {
    if (params.productId) {
      await this.stripe.products.update(params.productId, {
        name: params.name,
        description: params.description ?? undefined,
      });
      return params.productId;
    }
    const product = await this.stripe.products.create(
      {
        name: params.name,
        description: params.description ?? undefined,
        metadata: { planId: params.planId },
      },
      { idempotencyKey: `product-${params.planId}` },
    );
    return product.id;
  }

  async createPrice(params: {
    productId: string;
    unitAmount: number;
    currency: string;
    interval: BillingInterval;
    intervalCount: number;
    planId: string;
  }): Promise<string> {
    const price = await this.stripe.prices.create({
      product: params.productId,
      unit_amount: params.unitAmount,
      currency: params.currency,
      recurring: { interval: INTERVALS[params.interval], interval_count: params.intervalCount },
      metadata: { planId: params.planId },
    });
    await this.stripe.products.update(params.productId, { default_price: price.id });
    return price.id;
  }

  async archivePrice(priceId: string): Promise<void> {
    await this.stripe.prices.update(priceId, { active: false });
  }

  async createCoupon(
    params: CreateCouponParams,
  ): Promise<{ couponId: string; promotionCodeId: string }> {
    const coupon = await this.stripe.coupons.create({
      name: params.name ?? params.code,
      ...(params.percentOff
        ? { percent_off: params.percentOff }
        : { amount_off: params.amountOffCents!, currency: params.currency! }),
      duration: params.duration.toLowerCase() as Stripe.CouponCreateParams.Duration,
      ...(params.duration === 'REPEATING' ? { duration_in_months: params.durationInMonths! } : {}),
      ...(params.maxRedemptions ? { max_redemptions: params.maxRedemptions } : {}),
      ...(params.redeemBy ? { redeem_by: Math.floor(params.redeemBy.getTime() / 1000) } : {}),
    });
    const promotion = await this.stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: params.code,
    } as Stripe.PromotionCodeCreateParams);
    return { couponId: coupon.id, promotionCodeId: promotion.id };
  }

  async setPromotionCodeActive(promotionCodeId: string, active: boolean): Promise<void> {
    await this.stripe.promotionCodes.update(promotionCodeId, { active });
  }
}
