import type { Coupon, Database, Plan } from '@stormvpn/database';
import type { StripeGateway } from './stripe.gateway';

/**
 * Keeps Stripe products/prices/coupons in sync with the database, which stays
 * the source of truth. Stripe prices are immutable: a price change creates a
 * new price and archives the old one (existing subscribers keep their price).
 */
export class StripeCatalogService {
  constructor(
    private readonly db: Database,
    private readonly gateway: StripeGateway | null,
  ) {}

  get enabled(): boolean {
    return this.gateway !== null;
  }

  async syncPlan(plan: Plan, options: { priceChanged?: boolean } = {}): Promise<Plan> {
    if (!this.gateway || plan.priceCents === 0) return plan;
    const productId = await this.gateway.ensureProduct({
      productId: plan.stripeProductId,
      name: plan.name,
      description: plan.description,
      planId: plan.id,
    });
    let priceId = plan.stripePriceId;
    if (!priceId || options.priceChanged) {
      const previous = priceId;
      priceId = await this.gateway.createPrice({
        productId,
        unitAmount: plan.priceCents,
        currency: plan.currency,
        interval: plan.billingInterval,
        intervalCount: plan.intervalCount,
        planId: plan.id,
      });
      if (previous) await this.gateway.archivePrice(previous);
    }
    if (productId === plan.stripeProductId && priceId === plan.stripePriceId) return plan;
    return this.db.plan.update({
      where: { id: plan.id },
      data: { stripeProductId: productId, stripePriceId: priceId },
    });
  }

  async syncCoupon(coupon: Coupon): Promise<Coupon> {
    if (!this.gateway || coupon.stripeCouponId) return coupon;
    const created = await this.gateway.createCoupon({
      code: coupon.code,
      name: coupon.name,
      percentOff: coupon.percentOff,
      amountOffCents: coupon.amountOffCents,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.durationInMonths,
      maxRedemptions: coupon.maxRedemptions,
      redeemBy: coupon.validUntil,
    });
    return this.db.coupon.update({
      where: { id: coupon.id },
      data: { stripeCouponId: created.couponId, stripePromotionCodeId: created.promotionCodeId },
    });
  }

  async setCouponActive(coupon: Coupon, active: boolean): Promise<void> {
    if (this.gateway && coupon.stripePromotionCodeId) {
      await this.gateway.setPromotionCodeActive(coupon.stripePromotionCodeId, active);
    }
  }
}
