import type { Coupon, Database } from '@stormvpn/database';
import type { CouponDto } from '@stormvpn/types';
import type { Clock } from '../../lib/clock';
import { badRequest } from '../../lib/errors';

export function toCouponDto(coupon: Coupon): CouponDto {
  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    percentOff: coupon.percentOff,
    amountOffCents: coupon.amountOffCents,
    currency: coupon.currency,
    duration: coupon.duration,
    durationInMonths: coupon.durationInMonths,
    maxRedemptions: coupon.maxRedemptions,
    timesRedeemed: coupon.timesRedeemed,
    validFrom: coupon.validFrom?.toISOString() ?? null,
    validUntil: coupon.validUntil?.toISOString() ?? null,
    isActive: coupon.isActive,
    planIds: coupon.planIds,
    stripeCouponId: coupon.stripeCouponId,
    createdAt: coupon.createdAt.toISOString(),
  };
}

/** Validates coupon applicability for a user and plan. */
export class CouponService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async validate(code: string, userId: string, planId?: string): Promise<Coupon> {
    const coupon = await this.db.coupon.findUnique({ where: { code } });
    const now = this.clock.now();
    const invalid = () => badRequest('invalid_coupon', 'This coupon code is not valid');
    if (!coupon || !coupon.isActive) throw invalid();
    if (coupon.validFrom && coupon.validFrom > now) throw invalid();
    if (coupon.validUntil && coupon.validUntil <= now) throw badRequest('coupon_expired', 'This coupon has expired');
    if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw badRequest('coupon_exhausted', 'This coupon has been fully redeemed');
    }
    if (planId && coupon.planIds.length > 0 && !coupon.planIds.includes(planId)) {
      throw badRequest('coupon_not_applicable', 'This coupon does not apply to the selected plan');
    }
    const redeemed = await this.db.couponRedemption.findUnique({ where: { couponId_userId: { couponId: coupon.id, userId } } });
    if (redeemed) throw badRequest('coupon_already_used', 'You have already used this coupon');
    return coupon;
  }
}
