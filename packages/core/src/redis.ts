import { Redis, type RedisOptions } from 'ioredis';

export { Redis } from 'ioredis';

/**
 * Creates an ioredis client. `maxRetriesPerRequest: null` is required for
 * BullMQ blocking connections; regular clients keep a bounded retry count.
 */
export function createRedis(
  url: string,
  options: RedisOptions & { forBullMq?: boolean } = {},
): Redis {
  const { forBullMq, ...rest } = options;
  return new Redis(url, {
    maxRetriesPerRequest: forBullMq ? null : 3,
    enableReadyCheck: true,
    lazyConnect: false,
    ...rest,
  });
}
