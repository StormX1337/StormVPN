import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getEntitlements } from '@stormvpn/core';
import { countryCodeSchema, idParamsSchema, listServersQuerySchema } from '@stormvpn/validation';
import { Region } from '@stormvpn/types';
import { authOf } from '../../lib/auth-context';
import { paymentRequired } from '../../lib/errors';
import { edgeCountry } from '../../lib/request';
import { toServerDto } from './server.mapper';

/** `/api/v1/servers` */
export async function serverRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { servers, selection, catalog } = app.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: { querystring: listServersQuerySchema } }, async (request) =>
    servers.list(authOf(request).userId, request.query),
  );

  /** Quick Connect preview: which server would be chosen right now. */
  app.get(
    '/recommended',
    {
      schema: {
        querystring: z.object({ country: countryCodeSchema.optional(), region: z.enum(Region).optional() }),
      },
    },
    async (request) => {
      const { userId } = authOf(request);
      const entitlements = await getEntitlements(app.deps.db, userId);
      if (!entitlements) throw paymentRequired('subscription_required', 'An active subscription is required');
      const outcome = await selection.resolve(userId, entitlements, request.query, edgeCountry(request));
      return {
        server: toServerDto(outcome.server, catalog.status(outcome.server), { isFavorite: false, allowed: true }),
        score: outcome.score,
        reason: outcome.reason,
      };
    },
  );

  app.get('/:id', { schema: { params: idParamsSchema } }, async (request) =>
    servers.get(authOf(request).userId, request.params.id),
  );

  app.put('/:id/favorite', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await servers.setFavorite(authOf(request).userId, request.params.id, true);
    return reply.status(204).send();
  });

  app.delete('/:id/favorite', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await servers.setFavorite(authOf(request).userId, request.params.id, false);
    return reply.status(204).send();
  });
}
