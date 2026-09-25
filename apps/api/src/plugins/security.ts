import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiEnv } from '../env';

/** Security headers, CORS and cookie parsing. */
export const securityPlugin = fp(async (app: FastifyInstance, { env }: { env: ApiEnv }) => {
  await app.register(cookie, { parseOptions: {} });

  await app.register(helmet, {
    // The API only serves JSON: lock everything down.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  });

  const allowed = new Set([...env.CORS_ORIGINS, new URL(env.APP_URL).origin, new URL(env.ADMIN_URL).origin]);
  await app.register(cors, {
    origin: (origin, callback) => {
      // Same-origin and non-browser requests have no Origin header.
      if (!origin || allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-stormvpn-client', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
  });
});
