import type { DbClient, Plan, Subscription, SubscriptionStatus } from '@stormvpn/database';
import { startOfUtcMonth } from './time';

export const LIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

export type SubscriptionWithPlan = Subscription & { plan: Plan };

export interface Entitlements {
  subscription: SubscriptionWithPlan;
  plan: Plan;
  maxDevices: number;
  maxSessions: number;
  trafficLimitBytes: bigint | null;
  allowedCountries: string[];
  serverClasses: string[];
  priority: number;
}

export function isLiveStatus(status: SubscriptionStatus): boolean {
  return LIVE_SUBSCRIPTION_STATUSES.includes(status);
}

export async function getLiveSubscription(db: DbClient, userId: string): Promise<SubscriptionWithPlan | null> {
  return db.subscription.findFirst({
    where: { userId, status: { in: LIVE_SUBSCRIPTION_STATUSES } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function entitlementsFrom(subscription: SubscriptionWithPlan): Entitlements {
  const { plan } = subscription;
  return {
    subscription,
    plan,
    maxDevices: plan.maxDevices,
    maxSessions: plan.maxSessions,
    trafficLimitBytes: plan.trafficLimitBytes,
    allowedCountries: plan.allowedCountries,
    serverClasses: plan.serverClasses,
    priority: plan.priority,
  };
}

/** Resolves what the user may currently use, or null when no live subscription exists. */
export async function getEntitlements(db: DbClient, userId: string): Promise<Entitlements | null> {
  const subscription = await getLiveSubscription(db, userId);
  return subscription ? entitlementsFrom(subscription) : null;
}

export function isServerAllowed(
  entitlements: Pick<Entitlements, 'allowedCountries' | 'serverClasses'>,
  server: { countryCode: string; serverClass: string },
): boolean {
  const countryOk =
    entitlements.allowedCountries.length === 0 || entitlements.allowedCountries.includes(server.countryCode);
  return countryOk && entitlements.serverClasses.includes(server.serverClass);
}

export async function findFreePlan(db: DbClient): Promise<Plan | null> {
  return db.plan.findFirst({
    where: { priceCents: 0, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/** Gives the user the free plan when they have no live subscription (and a free plan exists). */
export async function ensureFreeSubscription(db: DbClient, userId: string): Promise<SubscriptionWithPlan | null> {
  const live = await getLiveSubscription(db, userId);
  if (live) return live;
  const plan = await findFreePlan(db);
  if (!plan) return null;
  const now = new Date();
  return db.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      provider: 'NONE',
      currentPeriodStart: now,
    },
    include: { plan: true },
  });
}

/** Traffic (rx + tx) used in the current calendar month. */
export async function getMonthlyTrafficBytes(db: DbClient, userId: string, now = new Date()): Promise<bigint> {
  const result = await db.trafficUsage.aggregate({
    where: { userId, day: { gte: startOfUtcMonth(now) } },
    _sum: { rxBytes: true, txBytes: true },
  });
  return (result._sum.rxBytes ?? 0n) + (result._sum.txBytes ?? 0n);
}
