import { Worker } from 'bullmq';
import {
  createLogger,
  loadEnv,
  QUEUE_EMAIL,
  QUEUE_MAINTENANCE,
  workerEnvSchema,
} from '@stormvpn/config';
import { BullMailQueue, createRedis, RedisEventPublisher, SettingsService } from '@stormvpn/core';
import { createPrismaClient } from '@stormvpn/database';
import { SmtpMailer } from './email/mailer';
import { startHealthServer } from './health';
import { createEmailProcessor, createMaintenanceProcessor } from './processors';

async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema);
  const logger = createLogger({
    name: 'stormvpn-worker',
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  });
  const db = createPrismaClient({ url: env.DATABASE_URL, applicationName: 'stormvpn-worker' });
  const redis = createRedis(env.REDIS_URL);
  const connection = createRedis(env.REDIS_URL, { forBullMq: true });
  const mail = new BullMailQueue(createRedis(env.REDIS_URL, { forBullMq: true }));
  const mailer = new SmtpMailer(env);

  const emailWorker = new Worker(QUEUE_EMAIL, createEmailProcessor(mailer, env.APP_URL, logger), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    limiter: { max: 20, duration: 1000 },
  });
  const maintenanceWorker = new Worker(
    QUEUE_MAINTENANCE,
    createMaintenanceProcessor({
      db,
      redis,
      mail,
      events: new RedisEventPublisher(redis),
      settings: new SettingsService(db),
      logger,
      config: {
        nodeOfflineAfterSeconds: env.NODE_OFFLINE_AFTER_SECONDS,
        connectionStaleAfterSeconds: env.CONNECTION_STALE_AFTER_SECONDS,
        heartbeatRetentionDays: env.HEARTBEAT_RETENTION_DAYS,
        auditRetentionDays: env.AUDIT_RETENTION_DAYS,
        connectionRetentionDays: 30,
      },
    }),
    { connection: createRedis(env.REDIS_URL, { forBullMq: true }), concurrency: 1 },
  );

  for (const worker of [emailWorker, maintenanceWorker]) {
    worker.on('failed', (job, error) =>
      logger.error(
        { err: error, job: job?.name, queue: worker.name, attempts: job?.attemptsMade },
        'job failed',
      ),
    );
    worker.on('error', (error) => logger.error({ err: error, queue: worker.name }, 'worker error'));
  }

  const health = startHealthServer(env.HEALTH_PORT, async () => {
    await Promise.all([redis.ping(), db.$queryRaw`SELECT 1`]);
    return emailWorker.isRunning() && maintenanceWorker.isRunning();
  });
  if (!(await mailer.verify()))
    logger.warn({ host: env.SMTP_HOST }, 'SMTP server not reachable – emails will be retried');
  logger.info('worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    health.close();
    await Promise.allSettled([emailWorker.close(), maintenanceWorker.close(), mail.close()]);
    await Promise.allSettled([db.$disconnect(), redis.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
