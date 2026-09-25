import Stripe from 'stripe';
import type { EmailJob, EventPublisher, MailQueue } from '@stormvpn/core';
import type { RealtimeMessage } from '@stormvpn/types';
import type {
  CheckoutParams,
  CreateCouponParams,
  GatewayEvent,
  NormalizedSubscription,
  StripeGateway,
} from '../../src/modules/billing/stripe.gateway';

export class CapturingMailQueue implements MailQueue {
  readonly sent: EmailJob[] = [];

  async send(job: EmailJob): Promise<void> {
    this.sent.push(job);
  }

  last(template: EmailJob['template'], to?: string): EmailJob | undefined {
    return [...this.sent].reverse().find((job) => job.template === template && (!to || job.to === to));
  }

  /** Extracts the `token` query parameter from the link of the latest email. */
  tokenFrom(template: EmailJob['template'], to?: string): string {
    const link = String(this.last(template, to)?.data.link ?? '');
    const token = new URL(link).searchParams.get('token');
    if (!token) throw new Error(`No ${template} email with token for ${to ?? 'anyone'}`);
    return token;
  }
}

export class CapturingEventPublisher implements EventPublisher {
  readonly userEvents: { userId: string; message: RealtimeMessage }[] = [];
  readonly adminEvents: RealtimeMessage[] = [];

  async toUser(userId: string, message: RealtimeMessage): Promise<void> {
    this.userEvents.push({ userId, message });
  }

  async toAdmins(message: RealtimeMessage): Promise<void> {
    this.adminEvents.push(message);
  }
}

export const TEST_WEBHOOK_SECRET = 'whsec_test_stormvpn_secret';

/** In-memory Stripe double with real webhook signature verification. */
export class FakeStripeGateway implements StripeGateway {
  private readonly stripe = new Stripe('sk_test_fake_key_for_signatures');
  readonly subscriptions = new Map<string, NormalizedSubscription>();
  readonly checkouts: CheckoutParams[] = [];
  readonly calls: string[] = [];
  private counter = 0;

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}_test_${this.counter}`;
  }

  async createCustomer(): Promise<string> {
    this.calls.push('createCustomer');
    return this.id('cus');
  }

  async createCheckoutSession(params: CheckoutParams) {
    this.checkouts.push(params);
    const id = this.id('cs');
    return { id, url: `https://checkout.stripe.test/${id}` };
  }

  async createPortalSession(customerId: string) {
    return `https://billing.stripe.test/portal/${customerId}`;
  }

  async retrieveSubscription(subscriptionId: string): Promise<NormalizedSubscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error(`unknown subscription ${subscriptionId}`);
    return subscription;
  }

  async changeSubscriptionPrice(subscriptionId: string, priceId: string): Promise<void> {
    const subscription = await this.retrieveSubscription(subscriptionId);
    this.subscriptions.set(subscriptionId, { ...subscription, priceId, cancelAtPeriodEnd: false });
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void> {
    const subscription = await this.retrieveSubscription(subscriptionId);
    this.subscriptions.set(subscriptionId, { ...subscription, cancelAtPeriodEnd: cancel });
  }

  async cancelSubscriptionNow(subscriptionId: string): Promise<void> {
    const subscription = await this.retrieveSubscription(subscriptionId);
    this.subscriptions.set(subscriptionId, { ...subscription, status: 'canceled', endedAt: new Date() });
  }

  constructEvent(payload: Buffer, signature: string): GatewayEvent {
    return this.stripe.webhooks.constructEvent(payload, signature, TEST_WEBHOOK_SECRET) as unknown as GatewayEvent;
  }

  sign(payload: string): string {
    return this.stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
  }

  async ensureProduct(params: { productId: string | null }): Promise<string> {
    return params.productId ?? this.id('prod');
  }

  async createPrice(): Promise<string> {
    return this.id('price');
  }

  async archivePrice(): Promise<void> {
    this.calls.push('archivePrice');
  }

  async createCoupon(_params: CreateCouponParams) {
    return { couponId: this.id('coupon'), promotionCodeId: this.id('promo') };
  }

  async setPromotionCodeActive(): Promise<void> {}
}
