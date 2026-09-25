import type { Logger } from '@stormvpn/config';
import type { MailQueue } from '@stormvpn/core';
import { type Database, type InvoiceStatus, isUniqueViolation } from '@stormvpn/database';
import type { Clock } from '../../lib/clock';
import { conflict } from '../../lib/errors';
import type { GatewayEvent, NormalizedInvoice } from './stripe.gateway';
import { normalizeInvoice } from './stripe.gateway';
import type { SubscriptionSyncService } from './subscription-sync.service';

const STALE_PROCESSING_MS = 5 * 60_000;

const INVOICE_STATUS: Record<string, InvoiceStatus> = {
  draft: 'DRAFT',
  open: 'OPEN',
  paid: 'PAID',
  void: 'VOID',
  uncollectible: 'UNCOLLECTIBLE',
};

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';

/**
 * Idempotent Stripe webhook processing.
 *   Stripe → signature check → claim event id (unique) → handler → PROCESSED
 * Re-deliveries of processed events are acknowledged without side effects;
 * failures are recorded and surfaced as 500 so Stripe retries with backoff.
 */
export class StripeWebhookService {
  constructor(
    private readonly db: Database,
    private readonly sync: SubscriptionSyncService,
    private readonly mail: MailQueue,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  private async claim(event: GatewayEvent): Promise<boolean> {
    try {
      await this.db.webhookEvent.create({
        data: { id: event.id, provider: 'STRIPE', type: event.type, status: 'PROCESSING' },
      });
      return true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const existing = await this.db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    if (existing.status === 'PROCESSED') return false;
    const staleBefore = new Date(this.clock.now().getTime() - STALE_PROCESSING_MS);
    const reclaimed = await this.db.webhookEvent.updateMany({
      where: {
        id: event.id,
        OR: [{ status: 'FAILED' }, { status: 'PROCESSING', receivedAt: { lt: staleBefore } }],
      },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, receivedAt: this.clock.now() },
    });
    if (reclaimed.count === 0) throw conflict('webhook_in_progress', 'Event is being processed');
    return true;
  }

  async handle(event: GatewayEvent): Promise<WebhookOutcome> {
    if (!(await this.claim(event))) return 'duplicate';
    try {
      const handled = await this.dispatch(event);
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: this.clock.now(), lastError: null },
      });
      return handled ? 'processed' : 'ignored';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', lastError: message.slice(0, 2000), payload: event as never },
      });
      this.logger.error({ err: error, eventId: event.id, type: event.type }, 'stripe webhook processing failed');
      throw error;
    }
  }

  private async dispatch(event: GatewayEvent): Promise<boolean> {
    const object = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const subscription = object.subscription as string | { id: string } | null;
        if (object.mode !== 'subscription' || !subscription) return false;
        const id = typeof subscription === 'string' ? subscription : subscription.id;
        await this.sync.syncById(id, { userId: (object.client_reference_id as string | null) ?? null });
        return true;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await this.sync.syncById(object.id as string);
        return true;
      case 'customer.subscription.trial_will_end':
        await this.notifyTrialEnding(object.id as string, object.trial_end as number | null);
        return true;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.recordInvoice(normalizeInvoice(object), 'SUCCEEDED');
        return true;
      case 'invoice.payment_failed':
        await this.recordInvoice(normalizeInvoice(object), 'FAILED');
        return true;
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.updated':
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await this.recordInvoice(normalizeInvoice(object), null);
        return true;
      case 'customer.deleted':
        await this.db.user.updateMany({ where: { stripeCustomerId: object.id as string }, data: { stripeCustomerId: null } });
        return true;
      default:
        return false;
    }
  }

  private async recordInvoice(invoice: NormalizedInvoice, paymentOutcome: 'SUCCEEDED' | 'FAILED' | null): Promise<void> {
    if (!invoice.customerId) return;
    const user = await this.db.user.findUnique({ where: { stripeCustomerId: invoice.customerId } });
    if (!user) {
      this.logger.warn({ invoiceId: invoice.id }, 'invoice for unknown customer ignored');
      return;
    }
    // Make sure the subscription (renewal period, status) is current before linking.
    if (invoice.subscriptionId && paymentOutcome) await this.sync.syncById(invoice.subscriptionId);
    const subscription = invoice.subscriptionId
      ? await this.db.subscription.findUnique({ where: { stripeSubscriptionId: invoice.subscriptionId } })
      : null;

    const data = {
      userId: user.id,
      subscriptionId: subscription?.id ?? null,
      number: invoice.number,
      status: INVOICE_STATUS[invoice.status ?? 'open'] ?? 'OPEN',
      amountDueCents: invoice.amountDue,
      amountPaidCents: invoice.amountPaid,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      invoicePdfUrl: invoice.invoicePdf,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      paidAt: invoice.paidAt,
    };
    const saved = await this.db.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: { ...data, stripeInvoiceId: invoice.id },
      update: data,
    });
    if (!paymentOutcome) return;

    const amount = paymentOutcome === 'SUCCEEDED' ? invoice.amountPaid : invoice.amountDue;
    if (amount === 0 && paymentOutcome === 'SUCCEEDED') return; // trial / 100% coupon invoices
    const paymentData = {
      userId: user.id,
      subscriptionId: subscription?.id ?? null,
      invoiceId: saved.id,
      amountCents: amount,
      currency: invoice.currency,
      status: paymentOutcome,
      provider: 'STRIPE' as const,
      failureReason: paymentOutcome === 'FAILED' ? (invoice.failureMessage ?? 'Payment failed') : null,
      paidAt: paymentOutcome === 'SUCCEEDED' ? (invoice.paidAt ?? this.clock.now()) : null,
    };
    await this.db.payment.upsert({
      where: { providerReference: invoice.id },
      create: { ...paymentData, providerReference: invoice.id },
      update: paymentData,
    });
    if (paymentOutcome === 'FAILED') {
      await this.mail.send({
        template: 'payment-failed',
        to: user.email,
        data: { amount: (invoice.amountDue / 100).toFixed(2), currency: invoice.currency.toUpperCase(), invoiceUrl: invoice.hostedInvoiceUrl },
      });
    }
  }

  private async notifyTrialEnding(stripeSubscriptionId: string, trialEnd: number | null): Promise<void> {
    const subscription = await this.db.subscription.findUnique({
      where: { stripeSubscriptionId },
      include: { user: { select: { email: true } }, plan: { select: { name: true } } },
    });
    if (!subscription) return;
    await this.mail.send({
      template: 'trial-ending',
      to: subscription.user.email,
      data: { plan: subscription.plan.name, trialEnd: trialEnd ? new Date(trialEnd * 1000).toISOString() : null },
    });
  }
}
