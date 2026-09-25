import { type Plan, toNullableNumber } from '@stormvpn/database';
import type { AdminPlanDto, PlanDto } from '@stormvpn/types';

export function toPlanDto(plan: Plan): PlanDto {
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    intervalCount: plan.intervalCount,
    trialDays: plan.trialDays,
    maxDevices: plan.maxDevices,
    maxSessions: plan.maxSessions,
    trafficLimitBytes: toNullableNumber(plan.trafficLimitBytes),
    allowedCountries: plan.allowedCountries,
    serverClasses: plan.serverClasses,
    priority: plan.priority,
    features: Array.isArray(plan.features) ? (plan.features as string[]) : [],
    isFree: plan.priceCents === 0,
  };
}

export function toAdminPlanDto(plan: Plan, subscriberCount: number): AdminPlanDto {
  return {
    ...toPlanDto(plan),
    isActive: plan.isActive,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
    stripeProductId: plan.stripeProductId,
    stripePriceId: plan.stripePriceId,
    subscriberCount,
    createdAt: plan.createdAt.toISOString(),
  };
}
