import type { SubscriptionWithPlan } from '@stormvpn/core';
import type { SubscriptionDto } from '@stormvpn/types';
import { toPlanDto } from './plan.mapper';

export function toSubscriptionDto(subscription: SubscriptionWithPlan): SubscriptionDto {
  return {
    id: subscription.id,
    status: subscription.status,
    provider: subscription.provider,
    plan: toPlanDto(subscription.plan),
    currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
    trialEnd: subscription.trialEnd?.toISOString() ?? null,
    paymentMethod:
      subscription.paymentMethodBrand && subscription.paymentMethodLast4
        ? {
            brand: subscription.paymentMethodBrand,
            last4: subscription.paymentMethodLast4,
            expMonth: subscription.paymentMethodExpMonth,
            expYear: subscription.paymentMethodExpYear,
          }
        : null,
  };
}
