import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createPrismaClient } from '../client';
import { seedPlans } from './plans';
import { seedServers } from './servers';
import { seedTraffic } from './traffic';
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
    console.log(`✔ demo nodes: ${servers.demoNodes.length} (simulated – run \`pnpm demo:fleet\` to keep them alive)`);
    await seedTraffic(prisma, [users.user.id, users.admin.id], servers.servers);
    console.log('✔ 30 days of demo traffic');
    // Demo node tokens for scripts/simulate-fleet.ts (gitignored, development only).
    await writeFile(
      fileURLToPath(new URL('../../.demo-nodes.json', import.meta.url)),
      `${JSON.stringify(servers.demoNodes, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log('');
    console.log('Development credentials (never use in production):');
    console.log(`  admin login     ${users.admin.email} / ${users.admin.password}`);
    console.log(`  user login      ${users.user.email} / ${users.user.password}`);
    console.log(`  enrollment token for ${servers.enrollment.serverName}: ${servers.enrollment.token}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
