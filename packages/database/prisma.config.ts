import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load the monorepo root .env for local development (no-op in containers).
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed/index.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
