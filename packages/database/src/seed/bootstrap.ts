/**
 * Production bootstrap used by `install.sh` (safe to re-run, no demo data):
 *  - creates the starter plans when no plan exists yet,
 *  - creates/updates the first admin account (BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD),
 *  - optionally creates a VPN server for this host (BOOTSTRAP_SERVER_IPV4, …) and, while no node
 *    is registered for it, prints a fresh enrollment token as `ENROLLMENT_TOKEN=<token>`.
 */
import { generatePrefixedToken, hashPassword, sha256Hex } from '@stormvpn/crypto/node';
import { getCountry } from '@stormvpn/types';
import type { Region } from '../../generated/prisma/client';
import { createPrismaClient } from '../client';
import { seedPlans } from './plans';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient({
    url: required('DATABASE_URL'),
    applicationName: 'stormvpn-bootstrap',
  });
  try {
    if ((await prisma.plan.count()) === 0) {
      const plans = await seedPlans(prisma);
      console.log(`✔ plans: ${plans.map((plan) => plan.slug).join(', ')}`);
    }

    const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
    const passwordHash = await hashPassword(required('BOOTSTRAP_ADMIN_PASSWORD'));
    const admin = await prisma.user.upsert({
      where: { email },
      create: { email, name: 'Admin', role: 'ADMIN', passwordHash, emailVerifiedAt: new Date() },
      update: { role: 'ADMIN', status: 'ACTIVE', passwordHash },
    });
    const live = await prisma.subscription.findFirst({
      where: { userId: admin.id, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    });
    const topPlan = await prisma.plan.findFirst({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });
    if (!live && topPlan) {
      const now = new Date();
      await prisma.subscription.create({
        data: {
          userId: admin.id,
          planId: topPlan.id,
          status: 'ACTIVE',
          provider: 'NONE',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 10 * 365 * 24 * 3600 * 1000),
        },
      });
    }
    console.log(`✔ admin: ${admin.email}`);

    const publicIpv4 = process.env.BOOTSTRAP_SERVER_IPV4?.trim();
    if (!publicIpv4) return;

    const countryCode = (process.env.BOOTSTRAP_SERVER_COUNTRY ?? 'DE').trim().toUpperCase();
    const country = getCountry(countryCode);
    const name = required('BOOTSTRAP_SERVER_NAME').toUpperCase();
    let server = await prisma.vPNServer.findUnique({ where: { name } });
    if (!server) {
      // Next free /20 client subnet (10.80.0.0/20, 10.80.16.0/20, …).
      const index = await prisma.vPNServer.count();
      server = await prisma.vPNServer.create({
        data: {
          name,
          hostname: required('BOOTSTRAP_SERVER_HOSTNAME'),
          countryCode,
          city: process.env.BOOTSTRAP_SERVER_CITY?.trim() || country?.name || countryCode,
          region: (country?.region ?? 'EUROPE') as Region,
          latitude: country?.lat ?? null,
          longitude: country?.lon ?? null,
          publicIpv4,
          serverClass: 'STANDARD',
          capacity: 250,
          bandwidthCapacityMbps: 1_000,
          wgSubnetV4: `10.${80 + Math.floor(index / 16)}.${(index % 16) * 16}.0/20`,
          wgSubnetV6: `fd80:${(index + 1).toString(16)}::/64`,
          dnsServers: [],
        },
      });
    }
    console.log(`✔ server: ${server.name} (${server.publicIpv4})`);

    const node = await prisma.vPNNode.findUnique({ where: { serverId: server.id } });
    if (node) return;
    const token = generatePrefixedToken('sne');
    await prisma.vPNServer.update({
      where: { id: server.id },
      data: {
        enrollmentTokenHash: sha256Hex(token),
        enrollmentExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    console.log(`ENROLLMENT_TOKEN=${token}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
