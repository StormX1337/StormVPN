import { createLogger } from '@stormvpn/config';
import { BullMailQueue, createRedis, RedisEventPublisher } from '@stormvpn/core';
import { createPrismaClient } from '@stormvpn/database';
import { buildApp } from './app';
import { loadApiEnv } from './env';
import { systemClock } from './lib/clock';
import { StripeSdkGateway } from './modules/billing/stripe.gateway';

async function main(): Promise<void> {
  const env = loadApiEnv();
  const logger = createLogger({
    name: 'stormvpn-api',
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  });
  const db = createPrismaClient({
    url: env.DATABASE_URL,
    applicationName: 'stormvpn-api',
    poolSize: 20,
  });
  const redis = createRedis(env.REDIS_URL);
  const redisSubscriber = createRedis(env.REDIS_URL);
  const mail = new BullMailQueue(createRedis(env.REDIS_URL, { forBullMq: true }));
  const stripe = env.STRIPE_SECRET_KEY
    ? new StripeSdkGateway(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
    : null;
  if (!stripe) logger.warn('STRIPE_SECRET_KEY not set – paid plans and checkout are disabled');

  const app = await buildApp({
    env,
    db,
    redis,
    redisSubscriber,
    logger,
    mail,
    events: new RedisEventPublisher(redis),
    stripe,
    clock: systemClock,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), 15_000);
    try {
      await app.close();
      await mail.close();
      await Promise.all([db.$disconnect(), redis.quit()]);
      clearTimeout(timer);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
