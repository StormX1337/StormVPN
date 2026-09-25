import type { Redis } from 'ioredis';

export interface CounterResult {
  count: number;
  ttlSeconds: number;
  exceeded: boolean;
}

/**
 * Fixed-window counter in Redis (atomic INCR + EXPIRE on first hit).
 * Used for brute-force protection, registration limits and abuse quotas.
 */
export class RedisCounter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<CounterResult> {
    const results = await this.redis
      .multi()
      .incr(key)
      .expire(key, windowSeconds, 'NX')
      .ttl(key)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttlSeconds = Number(results?.[2]?.[1] ?? windowSeconds);
    return { count, ttlSeconds, exceeded: count > limit };
  }

  async peek(key: string): Promise<CounterResult & { ttlSeconds: number }> {
    const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    return { count: Number(count ?? 0), ttlSeconds: Math.max(0, ttl), exceeded: false };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
