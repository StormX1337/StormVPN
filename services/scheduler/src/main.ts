import { createServer } from 'node:http';
import { createLogger, loadEnv, schedulerEnvSchema } from '@stormvpn/config';
import { createMaintenanceQueue, createRedis } from '@stormvpn/core';
import { applySchedule, buildSchedule } from './schedule';

const RECONCILE_INTERVAL_MS = 5 * 60_000;

async function main(): Promise<void> {
  const env = loadEnv(schedulerEnvSchema);
  const logger = createLogger({ name: 'stormvpn-scheduler', level: env.LOG_LEVEL, pretty: env.LOG_PRETTY });
  const redis = createRedis(env.REDIS_URL, { forBullMq: true });
  const queue = createMaintenanceQueue(redis);
  const schedule = buildSchedule();

  const reconcile = async () => {
    const removed = await applySchedule(queue, schedule);
    logger.info({ jobs: schedule.map((entry) => `${entry.name}@${entry.everyMs / 1000}s`), removed }, 'maintenance schedule applied');
  };
  await reconcile();
  const timer = setInterval(() => void reconcile().catch((error: unknown) => logger.error({ err: error }, 'reconcile failed')), RECONCILE_INTERVAL_MS);

  const health = createServer((request, response) => {
    if (request.url !== '/health') return void response.writeHead(404).end();
    redis
      .ping()
      .then(() => response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'))
      .catch(() => response.writeHead(503).end());
  }).listen(env.HEALTH_PORT, '0.0.0.0');

  const shutdown = async () => {
    clearInterval(timer);
    health.close();
    await queue.close();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
