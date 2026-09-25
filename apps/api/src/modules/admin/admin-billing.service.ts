import { type ActorContext, writeAuditLog } from '@stormvpn/core';
import { type Database, isUniqueViolation, type Prisma } from '@stormvpn/database';
import type { AdminPlanDto, AdminSubscriptionDto, CouponDto, Paginated, PaymentDto } from '@stormvpn/types';
import type { CouponCreateInput, PlanCreateInput, PlanUpdateInput } from '@stormvpn/validation';
import { badRequest, conflict, notFound, serviceUnavailable } from '../../lib/errors';
import { pageArgs, paginated } from '../../lib/pagination';
import type { StripeCatalogService } from '../billing/catalog.service';
import { toCouponDto } from '../billing/coupon.service';
import type { StripeGateway } from '../billing/stripe.gateway';
import type { SubscriptionSyncService } from '../billing/subscription-sync.service';
import { toAdminPlanDto } from '../subscriptions/plan.mapper';

const PRICE_FIELDS = ['priceCents', 'currency', 'billingInterval', 'intervalCount'] as const;

export class AdminBillingService {
  constructor(
    private readonly db: Database,
    private readonly catalog: StripeCatalogService,
    private readonly gateway: StripeGateway | null,
    private readonly sync: SubscriptionSyncService | null,
  ) {}

  // ── Subscriptions & payments ─────────────────────────────

  async listSubscriptions(query: { page: number; pageSize: number; status?: string; planId?: string; search?: string }): Promise<Paginated<AdminSubscriptionDto>> {
    const where: Prisma.SubscriptionWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.search ? { user: { email: { contains: query.search, mode: 'insensitive' } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: { user: { select: { email: true } }, plan: { select: { name: true } } },
      }),
      this.db.subscription.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: row.user.email,
        planId: row.planId,
        planName: row.plan.name,
        status: row.status,
        provider: row.provider,
        stripeSubscriptionId: row.stripeSubscriptionId,
        currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async cancelSubscription(id: string, immediately: boolean, actor: ActorContext): Promise<void> {
    const subscription = await this.db.subscription.findUnique({ where: { id } });
    if (!subscription) throw notFound('Subscription');
    if (subscription.provider === 'STRIPE' && subscription.stripeSubscriptionId) {
      if (!this.gateway) throw serviceUnavailable('billing_unavailable', 'Stripe is not configured');
      if (immediately) await this.gateway.cancelSubscriptionNow(subscription.stripeSubscriptionId);
      else await this.gateway.setCancelAtPeriodEnd(subscription.stripeSubscriptionId, true);
      await this.sync?.syncById(subscription.stripeSubscriptionId);
    } else {
      const now = new Date();
      await this.db.subscription.update({
        where: { id },
        data: immediately ? { status: 'CANCELED', endedAt: now, canceledAt: now } : { cancelAtPeriodEnd: true },
      });
    }
    await writeAuditLog(this.db, { ...actor, action: 'subscription.cancel', targetType: 'subscription', targetId: id, metadata: { immediately } });
  }

  async resyncSubscription(id: string, actor: ActorContext): Promise<void> {
    const subscription = await this.db.subscription.findUnique({ where: { id } });
    if (!subscription?.stripeSubscriptionId) throw badRequest('not_stripe', 'Only Stripe subscriptions can be re-synchronised');
    if (!this.sync) throw serviceUnavailable('billing_unavailable', 'Stripe is not configured');
    await this.sync.syncById(subscription.stripeSubscriptionId);
    await writeAuditLog(this.db, { ...actor, action: 'subscription.resync', targetType: 'subscription', targetId: id });
  }

  async listPayments(query: { page: number; pageSize: number; search?: string }): Promise<Paginated<PaymentDto>> {
    const where: Prisma.PaymentWhereInput = query.search
      ? { user: { email: { contains: query.search, mode: 'insensitive' } } }
      : {};
    const [rows, total] = await Promise.all([
      this.db.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query), include: { user: { select: { email: true } } } }),
      this.db.payment.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: row.user.email,
        amountCents: row.amountCents,
        currency: row.currency,
        status: row.status,
        provider: row.provider,
        failureReason: row.failureReason,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
      })),
      total,
      query,
    );
  }

  // ── Plans ────────────────────────────────────────────────

  async listPlans(): Promise<AdminPlanDto[]> {
    const [plans, counts] = await Promise.all([
      this.db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] }),
      this.db.subscription.groupBy({ by: ['planId'], where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } }, _count: { _all: true } }),
    ]);
    const byPlan = new Map(counts.map((row) => [row.planId, row._count._all]));
    return plans.map((plan) => toAdminPlanDto(plan, byPlan.get(plan.id) ?? 0));
  }

  async createPlan(input: PlanCreateInput, actor: ActorContext): Promise<AdminPlanDto> {
    try {
      const { trafficLimitBytes, ...rest } = input;
      let plan = await this.db.plan.create({
        data: { ...rest, trafficLimitBytes: trafficLimitBytes === null ? null : BigInt(trafficLimitBytes) },
      });
      plan = await this.catalog.syncPlan(plan);
      await writeAuditLog(this.db, { ...actor, action: 'plan.create', targetType: 'plan', targetId: plan.id, metadata: { slug: plan.slug } });
      return toAdminPlanDto(plan, 0);
    } catch (error) {
      if (isUniqueViolation(error, 'slug')) throw conflict('plan_exists', 'A plan with this slug already exists');
      throw error;
    }
  }

  async updatePlan(id: string, input: PlanUpdateInput, actor: ActorContext): Promise<AdminPlanDto> {
    const existing = await this.db.plan.findUnique({ where: { id } });
    if (!existing) throw notFound('Plan');
    const priceChanged = PRICE_FIELDS.some((field) => input[field] !== undefined && input[field] !== existing[field]);
    const { trafficLimitBytes, ...rest } = input;
    let plan = await this.db.plan.update({
      where: { id },
      data: {
        ...rest,
        ...(trafficLimitBytes !== undefined ? { trafficLimitBytes: trafficLimitBytes === null ? null : BigInt(trafficLimitBytes) } : {}),
      },
    });
    plan = await this.catalog.syncPlan(plan, { priceChanged });
    await writeAuditLog(this.db, { ...actor, action: 'plan.update', targetType: 'plan', targetId: id, metadata: { ...input, priceChanged } });
    const subscribers = await this.db.subscription.count({ where: { planId: id, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } });
    return toAdminPlanDto(plan, subscribers);
  }

  /** Plans with history are deactivated instead of deleted. */
  async deletePlan(id: string, actor: ActorContext): Promise<void> {
    const references = await this.db.subscription.count({ where: { planId: id } });
    if (references > 0) await this.db.plan.update({ where: { id }, data: { isActive: false, isPublic: false } });
    else await this.db.plan.delete({ where: { id } });
    await writeAuditLog(this.db, { ...actor, action: 'plan.delete', targetType: 'plan', targetId: id, metadata: { softDeleted: references > 0 } });
  }

  // ── Coupons ──────────────────────────────────────────────

  async listCoupons(): Promise<CouponDto[]> {
    const coupons = await this.db.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return coupons.map(toCouponDto);
  }

  async createCoupon(input: CouponCreateInput, actor: ActorContext): Promise<CouponDto> {
    try {
      let coupon = await this.db.coupon.create({
        data: {
          code: input.code,
          name: input.name ?? null,
          percentOff: input.percentOff ?? null,
          amountOffCents: input.amountOffCents ?? null,
          currency: input.currency ?? null,
          duration: input.duration,
          durationInMonths: input.durationInMonths ?? null,
          maxRedemptions: input.maxRedemptions ?? null,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          planIds: input.planIds,
        },
      });
      coupon = await this.catalog.syncCoupon(coupon);
      await writeAuditLog(this.db, { ...actor, action: 'coupon.create', targetType: 'coupon', targetId: coupon.id, metadata: { code: coupon.code } });
      return toCouponDto(coupon);
    } catch (error) {
      if (isUniqueViolation(error, 'code')) throw conflict('coupon_exists', 'A coupon with this code already exists');
      throw error;
    }
  }

  async updateCoupon(
    id: string,
    input: { isActive?: boolean; validUntil?: Date | null; maxRedemptions?: number | null },
    actor: ActorContext,
  ): Promise<CouponDto> {
    const coupon = await this.db.coupon.update({ where: { id }, data: input });
    if (input.isActive !== undefined) await this.catalog.setCouponActive(coupon, input.isActive);
    await writeAuditLog(this.db, { ...actor, action: 'coupon.update', targetType: 'coupon', targetId: id, metadata: input as Record<string, unknown> });
    return toCouponDto(coupon);
  }
}
