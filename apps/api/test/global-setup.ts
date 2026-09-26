import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://stormvpn:stormvpn_dev_password@localhost:5432/stormvpn_test';

/** Applies all migrations to the dedicated test database once per run. */
export default function setup(): void {
  const cwd = fileURLToPath(new URL('../../../packages/database', import.meta.url));
  execSync('pnpm exec prisma migrate deploy', {
    cwd,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
