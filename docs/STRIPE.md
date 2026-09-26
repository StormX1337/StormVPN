# Stripe integration

StormVPN uses Stripe Checkout (subscriptions), the Customer Portal (payment methods, invoices, cancellation) and webhooks. The **database is the source of truth for plans**; Stripe products/prices/coupons are created and kept in sync automatically.

```
Customer → POST /billing/checkout → Stripe Checkout → success_url /billing/success
Stripe ──webhook──► POST /api/v1/billing/webhook ──► signature check ──► idempotency ledger
        ──► SubscriptionSyncService (re-reads the subscription from Stripe) ──► PostgreSQL ──► peer reconciliation
```

Without `STRIPE_SECRET_KEY` the platform works with free and complimentary (admin-granted) plans only; billing endpoints return `503 billing_unavailable`.

## 11. Connect Stripe

1. **Keys** – Stripe Dashboard → Developers → API keys. Set `STRIPE_SECRET_KEY=sk_live_…` (or `sk_test_…`).
2. **Webhook endpoint** – Developers → Webhooks → _Add endpoint_: `https://<your-domain>/api/v1/billing/webhook`, events:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `customer.subscription.trial_will_end`
   - `invoice.created`, `invoice.finalized`, `invoice.updated`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`
   - `customer.deleted`

   Copy the signing secret to `STRIPE_WEBHOOK_SECRET=whsec_…` (required in production when a secret key is set).

3. **Customer Portal** – Settings → Billing → Customer portal: enable payment method updates, invoice history and cancellation (at period end). Optionally allow plan switching between the StormVPN products.
4. **Plans** – create/edit plans in Admin → Plans. For paid plans the API creates the Stripe product and a recurring price automatically (on creation or at the first checkout). Changing price, currency or interval creates a **new** price and archives the old one; existing subscribers keep their price (grandfathered, mapped back to the plan).
5. **Coupons** – Admin → Coupons creates a Stripe coupon + promotion code with the same code. Customers can enter it on the subscription page; Checkout also allows promotion codes directly.
6. **Emails** – Stripe sends receipts; StormVPN sends payment-failed and trial-ending emails.

## Local testing

```bash
stripe login
stripe listen --forward-to localhost:4000/api/v1/billing/webhook
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET and restart the API
stripe trigger checkout.session.completed
```

Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (attach succeeds, charge fails → `invoice.payment_failed`), `4000 0025 0000 3155` (3-D Secure).

## Flows

| Flow              | Behaviour                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout          | Requires verified email; blocked if a paid Stripe subscription exists (use change plan). Customer created once (idempotency key per user). `client_reference_id` + metadata carry `userId`, `planId`, `couponId`. |
| Trial             | `plan.trialDays` applied only if the user never had a trial (`users.trialUsedAt`) or a Stripe subscription.                                                                                                       |
| Activation        | Webhook → subscription upserted (`TRIALING`/`ACTIVE`), the free/complimentary subscription is ended in the same transaction (partial unique index: one live subscription per user), peers reconciled.             |
| Renewal           | `invoice.paid` → invoice + payment recorded, subscription period refreshed from Stripe.                                                                                                                           |
| Payment failed    | Invoice + failed payment recorded, email sent; Stripe dunning moves the subscription to `PAST_DUE` (still entitled) and later `CANCELED`/`UNPAID`.                                                                |
| Upgrade/downgrade | `POST /billing/change-plan` → subscription item price swapped with proration; switching to the free plan = cancel at period end.                                                                                  |
| Cancel / resume   | `cancel_at_period_end` toggled; access continues until the period ends.                                                                                                                                           |
| Ended             | Subscription `CANCELED` → user falls back to the free plan, peers outside the free plan are disabled (`PLAN_RESTRICTION`).                                                                                        |

## Idempotency & ordering

- Every event id is claimed in `webhook_events` (unique). Re-deliveries of processed events return `200 { outcome: "duplicate" }` without side effects; concurrent deliveries get `409` (Stripe retries); failed processing stores the error, returns `500` and is retried by Stripe.
- Handlers never trust the event payload's subscription state: they **re-read the subscription from Stripe**, so out-of-order events converge to the latest state.
- Invoices/payments are upserted by Stripe ids (`invoices.stripeInvoiceId`, `payments.providerReference`).
- API version differences (billing periods on subscription items since 2025-03-31, invoice → subscription reference under `parent.subscription_details`) are normalised in `stripe.gateway.ts`.

## Operations

- Admin → Subscriptions → _Sync_ re-reads a subscription from Stripe (e.g. after a missed webhook).
- Admin → Subscriptions → _Cancel_ cancels at period end (or immediately via API `{ immediately: true }`).
- Account deletion cancels active Stripe subscriptions immediately.
- Tests: `apps/api/test/billing.test.ts` covers signature verification, idempotency, activation, invoices/payments, fallback to free and cancel/resume with a Stripe double that uses real signature verification.
