import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { recordSecurityEvent } from '@stormvpn/core';
import type { ApiEnv } from '../env';

/**
 * Distributed rate limiting (Redis) keyed by client IP. Sensitive routes
 * (auth) declare stricter per-route limits via `config.rateLimit`.
 */
export const rateLimitPlugin = fp(
  async (app: FastifyInstance, opts: { env: ApiEnv; redis: Redis }) => {
    await app.register(rateLimit, {
      global: true,
      max: opts.env.RATE_LIMIT_MAX_PER_MINUTE,
      timeWindow: '1 minute',
      redis: opts.redis,
      nameSpace: 'rl:',
      skipOnError: true,
      keyGenerator: (request) => request.ip,
      errorResponseBuilder: (request, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'rate_limited',
        message: `Rate limit exceeded, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
      }),
      onExceeded: (request) => {
        if (!request.url.startsWith('/api/v1/auth')) return;
        void recordSecurityEvent(app.deps.db, {
          type: 'RATE_LIMITED',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          metadata: { route: request.routeOptions.url },
        }).catch(() => undefined);
      },
    });
  },
);
