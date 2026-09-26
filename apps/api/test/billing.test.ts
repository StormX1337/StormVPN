import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import type { NormalizedSubscription } from '../src/modules/billing/stripe.gateway';
import {
  call,
  createDevice,
  createHarness,
  createServer,
  type Harness,
  registerUser,
  seedPlans,
} from './helpers/harness';

let h: Harness;
let plans: Awaited<ReturnType<typeof seedPlans>>;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  plans = await seedPlans(h);
});

function stripeSubscription(
  overrides: Partial<NormalizedSubscription> & { customerId: string; userId: string },
): NormalizedSubscription {
  const now = Date.now();
  return {
    id: 'sub_test_1',
    status: 'active',
    priceId: 'price_pro_test',
    currentPeriodStart: new Date(now),
    currentPeriodEnd: new Date(now + 30 * 86_400_000),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    trialStart: null,
    trialEnd: null,
    paymentMethod: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
    ...overrides,
    metadata: { userId: overrides.userId, planId: plans.pro.id },
  };
}

async function sendWebhook(event: Record<string, unknown>, signature?: string) {
  const payload = JSON.stringify({
    object: 'event',
    created: Math.floor(Date.now() / 1000),
    ...event,
  });
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/billing/webhook',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature ?? h.stripe.sign(payload),
    },
    payload,
  });
}

async function checkoutUser(email = 'buyer@example.com') {
  const session = await registerUser(h, email);
  const checkout = await call(h, session, {
    method: 'POST',
    url: '/api/v1/billing/checkout',
    payload: { planId: plans.pro.id },
  });
  expect(checkout.statusCode, checkout.body).toBe(200);
  const user = await h.db.user.findUniqueOrThrow({ where: { id: session.userId } });
  return { session, customerId: user.stripeCustomerId! };
}

describe('checkout', () => {
  it('creates a Stripe customer and a checkout session with a one-time trial', async () => {
    const { session } = await checkoutUser();
    expect(h.stripe.checkouts[0]).toMatchObject({
      priceId: 'price_pro_test',
      trialDays: 7,
      userId: session.userId,
    });
    const overview = await call(h, session, { method: 'GET', url: '/api/v1/subscription' });
    expect(overview.json()).toMatchObject({
      trialEligible: true,
      subscription: { plan: { slug: 'free' } },
    });
  });

  it('rejects the free plan and unverified users', async () => {
    const session = await registerUser(h, 'unverified@example.com', { verify: false });
    const unverified = await call(h, session, {
      method: 'POST',
      url: '/api/v1/billing/checkout',
      payload: { planId: plans.pro.id },
    });
    expect(unverified.statusCode).toBe(403);
    const verified = await registerUser(h, 'verified@example.com');
    const free = await call(h, verified, {
      method: 'POST',
      url: '/api/v1/billing/checkout',
      payload: { planId: plans.free.id },
    });
    expect(free.statusCode).toBe(400);
  });
});

describe('Stripe webhooks', () => {
  it('rejects invalid signatures', async () => {
    const response = await sendWebhook(
      { id: 'evt_bad', type: 'invoice.paid', data: { object: {} } },
      't=1,v1=deadbeef',
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_signature');
  });

  it('activates the subscription on checkout completion and processes events idempotently', async () => {
    const { session, customerId } = await checkoutUser();
    h.stripe.subscriptions.set(
      'sub_test_1',
      stripeSubscription({
        customerId,
        userId: session.userId,
        status: 'trialing',
        trialEnd: new Date(Date.now() + 7 * 86_400_000),
      }),
    );
    const event = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'subscription',
          subscription: 'sub_test_1',
          client_reference_id: session.userId,
        },
      },
    };
    const first = await sendWebhook(event);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().outcome).toBe('processed');
    const duplicate = await sendWebhook(event);
    expect(duplicate.json().outcome).toBe('duplicate');

    const subscriptions = await h.db.subscription.findMany({
      where: { userId: session.userId },
      include: { plan: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]).toMatchObject({ status: 'CANCELED' }); // free plan replaced
    expect(subscriptions[1]).toMatchObject({
      status: 'TRIALING',
      provider: 'STRIPE',
      paymentMethodLast4: '4242',
    });
    expect(subscriptions[1]!.plan.slug).toBe('pro');
    expect(
      (await h.db.user.findUniqueOrThrow({ where: { id: session.userId } })).trialUsedAt,
    ).not.toBeNull();
    expect(await h.db.webhookEvent.count({ where: { status: 'PROCESSED' } })).toBe(1);

    const overview = await call(h, session, { method: 'GET', url: '/api/v1/subscription' });
    expect(overview.json()).toMatchObject({
      trialEligible: false,
      subscription: { status: 'TRIALING', plan: { slug: 'pro' } },
    });
  });

  it('records paid and failed invoices as payments', async () => {
    const { session, customerId } = await checkoutUser();
    h.stripe.subscriptions.set(
      'sub_test_1',
      stripeSubscription({ customerId, userId: session.userId }),
    );
    const invoice = (id: string, status: string, paid: number) => ({
      id,
      object: 'invoice',
      customer: customerId,
      number: `INV-${id}`,
      status,
      amount_due: 899,
      amount_paid: paid,
      currency: 'eur',
      hosted_invoice_url: `https://invoice.stripe.test/${id}`,
      invoice_pdf: null,
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 2_592_000,
      status_transitions: { paid_at: paid ? Math.floor(Date.now() / 1000) : null },
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_test_1', metadata: {} },
      },
    });
    expect(
      (
        await sendWebhook({
          id: 'evt_inv_paid',
          type: 'invoice.paid',
          data: { object: invoice('in_1', 'paid', 899) },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await sendWebhook({
          id: 'evt_inv_fail',
          type: 'invoice.payment_failed',
          data: { object: invoice('in_2', 'open', 0) },
        })
      ).statusCode,
    ).toBe(200);

    const payments = await h.db.payment.findMany({ orderBy: { createdAt: 'asc' } });
    expect(payments.map((payment) => payment.status)).toEqual(['SUCCEEDED', 'FAILED']);
    expect(payments[0]).toMatchObject({ amountCents: 899, currency: 'eur' });
    expect(h.mail.last('payment-failed')).toBeDefined();
    const invoices = await call(h, session, { method: 'GET', url: '/api/v1/billing/invoices' });
    expect(invoices.json()).toHaveLength(2);
    const subscription = await h.db.subscription.findFirstOrThrow({
      where: { provider: 'STRIPE' },
    });
    expect(subscription.status).toBe('ACTIVE');
  });

  it('falls back to the free plan when the subscription ends and restricts peers', async () => {
    const { session, customerId } = await checkoutUser();
    h.stripe.subscriptions.set(
      'sub_test_1',
      stripeSubscription({ customerId, userId: session.userId }),
    );
    await sendWebhook({
      id: 'evt_created',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_test_1' } },
    });

    const { server: premium } = await createServer(h, {
      name: 'DE-BER-01',
      serverClass: 'PREMIUM',
    });
    const device = await createDevice(h, session);
    const config = await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: {
        deviceId: device.id,
        serverId: premium.id,
        publicKey: generateWireGuardKeyPair().publicKey,
      },
    });
    expect(config.statusCode, config.body).toBe(200);

    h.stripe.subscriptions.set(
      'sub_test_1',
      stripeSubscription({
        customerId,
        userId: session.userId,
        status: 'canceled',
        endedAt: new Date(),
      }),
    );
    await sendWebhook({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test_1' } },
    });

    const live = await h.db.subscription.findFirstOrThrow({
      where: { userId: session.userId, status: 'ACTIVE' },
      include: { plan: true },
    });
    expect(live.plan.slug).toBe('free');
    const peer = await h.db.vPNPeer.findFirstOrThrow({ where: { deviceId: device.id } });
    expect(peer).toMatchObject({ status: 'DISABLED', disabledReason: 'PLAN_RESTRICTION' });
  });

  it('supports cancel at period end and resume', async () => {
    const { session, customerId } = await checkoutUser();
    h.stripe.subscriptions.set(
      'sub_test_1',
      stripeSubscription({ customerId, userId: session.userId }),
    );
    await sendWebhook({
      id: 'evt_created',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_test_1' } },
    });
    const cancel = await call(h, session, { method: 'POST', url: '/api/v1/billing/cancel' });
    expect(cancel.json().subscription).toMatchObject({ cancelAtPeriodEnd: true, status: 'ACTIVE' });
    const resume = await call(h, session, { method: 'POST', url: '/api/v1/billing/resume' });
    expect(resume.json().subscription.cancelAtPeriodEnd).toBe(false);
    const again = await call(h, session, {
      method: 'POST',
      url: '/api/v1/billing/checkout',
      payload: { planId: plans.pro.id },
    });
    expect(again.statusCode).toBe(409);
  });
});
