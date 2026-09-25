import type { Plan, PrismaClient } from '../../generated/prisma/client';

const GB = 1024 ** 3;

export const DEMO_PLANS = [
  {
    slug: 'free',
    name: 'StormVPN Free',
    description: 'Try StormVPN with one device and selected locations.',
    priceCents: 0,
    trialDays: 0,
    maxDevices: 1,
    maxSessions: 1,
    trafficLimitBytes: BigInt(10 * GB),
    allowedCountries: ['DE', 'NL'],
    serverClasses: ['STANDARD' as const],
    priority: 0,
    features: ['1 device', '10 GB / month', '2 locations', 'WireGuard®'],
    sortOrder: 0,
  },
  {
    slug: 'basic',
    name: 'StormVPN Basic',
    description: 'Unlimited traffic for your everyday devices.',
    priceCents: 499,
    trialDays: 7,
    maxDevices: 3,
    maxSessions: 3,
    trafficLimitBytes: null,
    allowedCountries: [],
    serverClasses: ['STANDARD' as const],
    priority: 10,
    features: ['3 devices', 'Unlimited traffic', 'All standard locations', 'Kill switch & DNS leak protection'],
    sortOrder: 10,
  },
  {
    slug: 'pro',
    name: 'StormVPN Pro',
    description: 'Premium servers, more devices and priority routing.',
    priceCents: 899,
    trialDays: 7,
    maxDevices: 6,
    maxSessions: 6,
    trafficLimitBytes: null,
    allowedCountries: [],
    serverClasses: ['STANDARD' as const, 'PREMIUM' as const],
    priority: 50,
    features: ['6 devices', 'Premium servers', 'Priority load balancing', 'Email support'],
    sortOrder: 20,
  },
  {
    slug: 'ultra',
    name: 'StormVPN Ultra',
    description: 'Every location, every server class, maximum devices.',
    priceCents: 1499,
    trialDays: 7,
    maxDevices: 10,
    maxSessions: 10,
    trafficLimitBytes: null,
    allowedCountries: [],
    serverClasses: ['STANDARD' as const, 'PREMIUM' as const, 'STREAMING' as const],
    priority: 100,
    features: ['10 devices', 'Streaming optimised servers', 'Highest priority', 'Priority support'],
    sortOrder: 30,
  },
];

export async function seedPlans(prisma: PrismaClient): Promise<Plan[]> {
  const plans: Plan[] = [];
  for (const plan of DEMO_PLANS) {
    const data = {
      ...plan,
      currency: 'eur',
      billingInterval: 'MONTH' as const,
      intervalCount: 1,
      isActive: true,
      isPublic: true,
    };
    plans.push(await prisma.plan.upsert({ where: { slug: plan.slug }, create: data, update: data }));
  }
  return plans;
}
