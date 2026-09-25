import { hashPassword } from '@stormvpn/crypto/node';
import type { Plan, PrismaClient, User } from '../../generated/prisma/client';

interface SeededUser extends User {
  password: string;
}

async function upsertUser(
  prisma: PrismaClient,
  params: { email: string; password: string; name: string; role: 'USER' | 'ADMIN' },
): Promise<SeededUser> {
  const passwordHash = await hashPassword(params.password);
  const user = await prisma.user.upsert({
    where: { email: params.email },
    create: {
      email: params.email,
      name: params.name,
      role: params.role,
      passwordHash,
      emailVerifiedAt: new Date(),
    },
    update: { role: params.role, passwordHash, status: 'ACTIVE' },
  });
  return { ...user, password: params.password };
}

async function ensureSubscription(prisma: PrismaClient, userId: string, plan: Plan): Promise<void> {
  const live = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
  });
  if (live) return;
  const now = new Date();
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      provider: 'NONE',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
    },
  });
}

export async function seedUsers(prisma: PrismaClient, plans: Plan[]) {
  const admin = await upsertUser(prisma, {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@stormvpn.local',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'StormAdmin!2026',
    name: 'Storm Admin',
    role: 'ADMIN',
  });
  const user = await upsertUser(prisma, {
    email: process.env.SEED_USER_EMAIL ?? 'demo@stormvpn.local',
    password: process.env.SEED_USER_PASSWORD ?? 'StormDemo!2026',
    name: 'Demo User',
    role: 'USER',
  });

  const pro = plans.find((plan) => plan.slug === 'pro') ?? plans[0]!;
  const ultra = plans.find((plan) => plan.slug === 'ultra') ?? pro;
  await ensureSubscription(prisma, user.id, pro);
  await ensureSubscription(prisma, admin.id, ultra);

  const deviceCount = await prisma.device.count({ where: { userId: user.id } });
  if (deviceCount === 0) {
    await prisma.device.createMany({
      data: [
        { userId: user.id, name: 'Work Laptop', platform: 'WINDOWS' },
        { userId: user.id, name: 'Pixel 9', platform: 'ANDROID' },
      ],
    });
  }
  return { admin, user };
}
