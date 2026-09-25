import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createPrismaClient } from '../client';
import { seedPlans } from './plans';
import { seedServers } from './servers';
import { seedUsers } from './users';

loadDotenv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refusing to seed demo data in production (set SEED_ALLOW_PRODUCTION=true to override)');
  }

  const prisma = createPrismaClient({ url, applicationName: 'stormvpn-seed' });
  try {
    const plans = await seedPlans(prisma);
    console.log(`✔ plans: ${plans.map((p) => p.slug).join(', ')}`);

    const users = await seedUsers(prisma, plans);
    console.log(`✔ admin: ${users.admin.email}`);
    console.log(`✔ user:  ${users.user.email}`);

    const servers = await seedServers(prisma);
    console.log(`✔ servers: ${servers.servers.length}`);
    console.log(`✔ demo node attached to ${servers.demoNode.serverName}`);
    console.log('');
    console.log('Development credentials (never use in production):');
    console.log(`  admin login     ${users.admin.email} / ${users.admin.password}`);
    console.log(`  user login      ${users.user.email} / ${users.user.password}`);
    console.log(`  demo node token ${servers.demoNode.nodeToken}`);
    console.log(`  enrollment token for ${servers.enrollment.serverName}: ${servers.enrollment.token}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
