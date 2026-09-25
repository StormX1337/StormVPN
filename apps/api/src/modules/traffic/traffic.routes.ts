import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { trafficQuerySchema } from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';

/** `/api/v1/traffic` */
export async function trafficRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);
  app.get('/summary', { schema: { querystring: trafficQuerySchema } }, async (request) =>
    app.services.traffic.summary(authOf(request).userId, request.query.days),
  );
}
