import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { VpnStatusDto } from '@stormvpn/types';
import {
  connectionHistoryQuerySchema,
  createConnectionSchema,
  idParamsSchema,
  wireguardConfigSchema,
} from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';
import { clientIp, edgeCountry, isNativeClient } from '../../lib/request';

/** `/api/v1/connections` */
export async function connectionRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { connections } = app.services;
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireVerifiedEmail);

  app.get('/', async (request) => connections.active(authOf(request).userId));

  app.get('/history', { schema: { querystring: connectionHistoryQuerySchema } }, async (request) =>
    connections.history(authOf(request).userId, request.query.limit),
  );

  app.get('/status', async (request): Promise<VpnStatusDto> => {
    const connection = await connections.current(authOf(request).userId);
    const connected = connection?.status === 'CONNECTED';
    return {
      connected,
      connection,
      publicIp: connected && connection ? connection.server.publicIpv4 : clientIp(request),
      killSwitch: { supportedByClient: isNativeClient(request), recommended: true },
    };
  });

  app.post('/', { schema: { body: createConnectionSchema } }, async (request, reply) => {
    const result = await connections.connect(authOf(request).userId, request.body, {
      ipAddress: clientIp(request),
      edgeCountry: edgeCountry(request),
    });
    return reply.status(201).send(result);
  });

  app.delete('/:id', { schema: { params: idParamsSchema } }, async (request) =>
    connections.disconnect(authOf(request).userId, request.params.id, 'user'),
  );
}

/** `/api/v1/wireguard` */
export async function wireguardRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { connections } = app.services;
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireVerifiedEmail);

  app.post('/config', { schema: { body: wireguardConfigSchema } }, async (request) =>
    connections.generateConfig(authOf(request).userId, request.body, {
      ipAddress: clientIp(request),
      edgeCountry: edgeCountry(request),
    }),
  );
}
