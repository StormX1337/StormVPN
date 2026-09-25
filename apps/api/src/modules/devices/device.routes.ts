import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createDeviceSchema, idParamsSchema, idSchema, updateDeviceSchema } from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';
import { clientIp } from '../../lib/request';

/** `/api/v1/devices` */
export async function deviceRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { devices } = app.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => devices.list(authOf(request).userId));

  app.post('/', { schema: { body: createDeviceSchema } }, async (request, reply) => {
    const device = await devices.create(authOf(request).userId, request.body, clientIp(request));
    return reply.status(201).send(device);
  });

  app.patch('/:id', { schema: { params: idParamsSchema, body: updateDeviceSchema } }, async (request, reply) => {
    await devices.rename(authOf(request).userId, request.params.id, request.body.name);
    return reply.status(204).send();
  });

  app.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await devices.remove(authOf(request).userId, request.params.id);
    return reply.status(204).send();
  });

  app.get('/:id/peers', { schema: { params: idParamsSchema } }, async (request) =>
    devices.listPeers(authOf(request).userId, request.params.id),
  );

  app.delete(
    '/:id/peers/:peerId',
    { schema: { params: z.object({ id: idSchema, peerId: idSchema }) } },
    async (request, reply) => {
      await devices.revokePeer(authOf(request).userId, request.params.id, request.params.peerId);
      return reply.status(204).send();
    },
  );
}
