import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { agentHeartbeatSchema, agentRegisterSchema } from '@stormvpn/validation';
import { nodeOf } from '../../lib/auth-context';
import { clientIp } from '../../lib/request';

/** `/api/v1/agent` – node agent ↔ control plane. Never used by browsers. */
export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { agent } = app.services;
  const nodeConfig = { csrf: false, rateLimit: { max: 120, timeWindow: '1 minute' } } as const;

  app.post(
    '/register',
    {
      config: { csrf: false, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: agentRegisterSchema },
    },
    async (request, reply) =>
      reply.status(201).send(await agent.register(request.body, clientIp(request))),
  );

  await app.register(async (authenticated) => {
    const routes = authenticated.withTypeProvider<ZodTypeProvider>();
    routes.addHook('preHandler', app.authenticateNode);

    routes.post(
      '/heartbeat',
      { config: nodeConfig, bodyLimit: 16 * 1024 * 1024, schema: { body: agentHeartbeatSchema } },
      async (request) => agent.heartbeat(nodeOf(request).nodeId, request.body),
    );

    routes.get('/config', { config: nodeConfig }, async (request, reply) => {
      const config = await agent.config(nodeOf(request).serverId);
      const etag = `"rev-${config.revision}"`;
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();
      void reply.header('etag', etag);
      return config;
    });

    routes.post('/rotate-token', { config: nodeConfig }, async (request) =>
      agent.rotateToken(nodeOf(request).nodeId),
    );
  });
}
