import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { type AppDeps, createServices } from './container';
import { accountRoutes, userRoutes } from './modules/account/account.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { agentRoutes } from './modules/agent/agent.routes';
import { nodeAuthPlugin } from './modules/agent/node-auth';
import { authRoutes } from './modules/auth/auth.routes';
import { billingRoutes, planRoutes, subscriptionRoutes } from './modules/billing/billing.routes';
import { connectionRoutes, wireguardRoutes } from './modules/connections/connection.routes';
import { deviceRoutes } from './modules/devices/device.routes';
import { healthRoutes } from './modules/health/health.routes';
import { realtimeRoutes } from './modules/realtime/realtime.routes';
import { serverRoutes } from './modules/servers/server.routes';
import { trafficRoutes } from './modules/traffic/traffic.routes';
import { authPlugin } from './plugins/auth';
import { csrfPlugin } from './plugins/csrf';
import { errorHandlerPlugin } from './plugins/error-handler';
import { metricsPlugin } from './plugins/metrics';
import { rateLimitPlugin } from './plugins/rate-limit';
import { securityPlugin } from './plugins/security';

type TrustProxy = boolean | string | string[] | ((address: string, hop: number) => boolean);

/** `true`/`false`, a hop count, or comma separated addresses/CIDRs/presets (loopback, uniquelocal). */
function parseTrustProxy(value: string): TrustProxy {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }
  return value.includes(',') ? value.split(',').map((entry) => entry.trim()) : value;
}

export interface BuildAppOptions {
  /** Business gauges query the DB on scrape; disabled in tests. */
  collectBusinessMetrics?: boolean;
  /** Start the realtime hub (Redis subscription + timers). */
  realtime?: boolean;
}

export async function buildApp(
  deps: AppDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    trustProxy: parseTrustProxy(deps.env.TRUST_PROXY),
    bodyLimit: 1024 * 1024,
    genReqId: () => randomUUID(),
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      disableRequestLogging: deps.env.NODE_ENV === 'test',
    }),
    routerOptions: { ignoreTrailingSlash: true },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const services = createServices(deps);
  app.decorate('deps', deps);
  app.decorate('services', services);

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, { env: deps.env });
  await app.register(rateLimitPlugin, { env: deps.env, redis: deps.redis });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  await app.register(csrfPlugin);
  await app.register(authPlugin);
  await app.register(nodeAuthPlugin, { db: deps.db, redis: deps.redis });
  await app.register(metricsPlugin, {
    env: deps.env,
    db: deps.db,
    redis: deps.redis,
    collectBusiness: options.collectBusinessMetrics,
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/user' });
      await api.register(accountRoutes, { prefix: '/account' });
      await api.register(deviceRoutes, { prefix: '/devices' });
      await api.register(serverRoutes, { prefix: '/servers' });
      await api.register(connectionRoutes, { prefix: '/connections' });
      await api.register(wireguardRoutes, { prefix: '/wireguard' });
      await api.register(trafficRoutes, { prefix: '/traffic' });
      await api.register(planRoutes, { prefix: '/plans' });
      await api.register(subscriptionRoutes, { prefix: '/subscription' });
      await api.register(billingRoutes, { prefix: '/billing' });
      await api.register(agentRoutes, { prefix: '/agent' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(realtimeRoutes);
    },
    { prefix: '/api/v1' },
  );

  if (options.realtime !== false) {
    app.addHook('onReady', async () => services.realtime.start());
    app.addHook('onClose', async () => services.realtime.stop());
  }
  return app;
}
