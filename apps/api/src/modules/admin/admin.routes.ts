import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ActorContext } from '@stormvpn/core';
import {
  adminConnectionsQuerySchema,
  adminGrantPlanSchema,
  adminPaymentsQuerySchema,
  adminSubscriptionsQuerySchema,
  adminTrafficQuerySchema,
  adminUsersQuerySchema,
  auditLogsQuerySchema,
  couponCreateSchema,
  couponUpdateSchema,
  idParamsSchema,
  killSwitchSchema,
  planCreateSchema,
  planUpdateSchema,
  riskFlagCreateSchema,
  securityEventsQuerySchema,
  serverCreateSchema,
  serverStatusSchema,
  serverUpdateSchema,
  settingsUpdateSchema,
  suspendUserSchema,
  updateUserRoleSchema,
} from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';
import { forbidden } from '../../lib/errors';
import { clientIp, userAgent } from '../../lib/request';

function actorOf(request: FastifyRequest): ActorContext {
  return {
    actorId: authOf(request).userId,
    actorType: 'ADMIN',
    ipAddress: clientIp(request),
    userAgent: userAgent(request),
  };
}

/**
 * `/api/v1/admin` – ADMIN has full access, SUPPORT is read-only.
 * Every mutation is written to the audit log by the services.
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { adminStats, adminUsers, adminInfra, adminBilling, adminSecurity } = app.services;

  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireRole('ADMIN', 'SUPPORT'));
  app.addHook('preHandler', async (request) => {
    if (request.method !== 'GET' && authOf(request).role !== 'ADMIN')
      throw forbidden('read_only', 'Support staff have read-only access');
  });

  const params = { schema: { params: idParamsSchema } };

  app.get('/stats', async () => adminStats.overview());

  // Users
  app.get('/users', { schema: { querystring: adminUsersQuerySchema } }, async (request) =>
    adminUsers.list(request.query),
  );
  app.get('/users/:id', params, async (request) => adminUsers.detail(request.params.id));
  app.post(
    '/users/:id/suspend',
    { schema: { params: idParamsSchema, body: suspendUserSchema } },
    async (request, reply) => {
      await adminUsers.suspend(request.params.id, request.body.reason, actorOf(request));
      return reply.status(204).send();
    },
  );
  app.post('/users/:id/unsuspend', params, async (request, reply) => {
    await adminUsers.unsuspend(request.params.id, actorOf(request));
    return reply.status(204).send();
  });
  app.patch(
    '/users/:id/role',
    { schema: { params: idParamsSchema, body: updateUserRoleSchema } },
    async (request, reply) => {
      await adminUsers.setRole(request.params.id, request.body.role, actorOf(request));
      return reply.status(204).send();
    },
  );
  app.post('/users/:id/sessions/revoke', params, async (request) => ({
    revoked: await adminUsers.revokeSessions(request.params.id, actorOf(request)),
  }));
  app.post('/users/:id/disconnect', params, async (request) => ({
    disconnected: await adminUsers.disconnect(request.params.id, actorOf(request)),
  }));
  app.post(
    '/users/:id/grant-plan',
    { schema: { params: idParamsSchema, body: adminGrantPlanSchema } },
    async (request, reply) => {
      await adminUsers.grantPlan(
        request.params.id,
        request.body.planId,
        request.body.days,
        actorOf(request),
      );
      return reply.status(204).send();
    },
  );

  // Subscriptions & payments
  app.get(
    '/subscriptions',
    { schema: { querystring: adminSubscriptionsQuerySchema } },
    async (request) => adminBilling.listSubscriptions(request.query),
  );
  app.post(
    '/subscriptions/:id/cancel',
    {
      schema: {
        params: idParamsSchema,
        body: z.object({ immediately: z.boolean().default(false) }),
      },
    },
    async (request, reply) => {
      await adminBilling.cancelSubscription(
        request.params.id,
        request.body.immediately,
        actorOf(request),
      );
      return reply.status(204).send();
    },
  );
  app.post('/subscriptions/:id/sync', params, async (request, reply) => {
    await adminBilling.resyncSubscription(request.params.id, actorOf(request));
    return reply.status(204).send();
  });
  app.get('/payments', { schema: { querystring: adminPaymentsQuerySchema } }, async (request) =>
    adminBilling.listPayments(request.query),
  );

  // Plans
  app.get('/plans', async () => adminBilling.listPlans());
  app.post('/plans', { schema: { body: planCreateSchema } }, async (request, reply) =>
    reply.status(201).send(await adminBilling.createPlan(request.body, actorOf(request))),
  );
  app.patch(
    '/plans/:id',
    { schema: { params: idParamsSchema, body: planUpdateSchema } },
    async (request) => adminBilling.updatePlan(request.params.id, request.body, actorOf(request)),
  );
  app.delete('/plans/:id', params, async (request, reply) => {
    await adminBilling.deletePlan(request.params.id, actorOf(request));
    return reply.status(204).send();
  });

  // Coupons
  app.get('/coupons', async () => adminBilling.listCoupons());
  app.post('/coupons', { schema: { body: couponCreateSchema } }, async (request, reply) =>
    reply.status(201).send(await adminBilling.createCoupon(request.body, actorOf(request))),
  );
  app.patch(
    '/coupons/:id',
    { schema: { params: idParamsSchema, body: couponUpdateSchema } },
    async (request) => adminBilling.updateCoupon(request.params.id, request.body, actorOf(request)),
  );

  // Servers
  app.get('/servers', async () => adminInfra.listServers());
  app.get('/servers/:id', params, async (request) => adminInfra.getServer(request.params.id));
  app.post('/servers', { schema: { body: serverCreateSchema } }, async (request, reply) =>
    reply.status(201).send(await adminInfra.createServer(request.body, actorOf(request))),
  );
  app.patch(
    '/servers/:id',
    { schema: { params: idParamsSchema, body: serverUpdateSchema } },
    async (request) => adminInfra.updateServer(request.params.id, request.body, actorOf(request)),
  );
  app.delete('/servers/:id', params, async (request, reply) => {
    await adminInfra.deleteServer(request.params.id, actorOf(request));
    return reply.status(204).send();
  });
  app.post(
    '/servers/:id/status',
    { schema: { params: idParamsSchema, body: serverStatusSchema } },
    async (request) =>
      adminInfra.setServerStatus(request.params.id, request.body.status, actorOf(request)),
  );
  app.post(
    '/servers/:id/kill-switch',
    { schema: { params: idParamsSchema, body: killSwitchSchema } },
    async (request) =>
      adminInfra.setKillSwitch(
        request.params.id,
        request.body.engaged,
        request.body.reason,
        actorOf(request),
      ),
  );
  app.post('/servers/:id/enrollment-token', params, async (request) =>
    adminInfra.createEnrollmentToken(request.params.id, actorOf(request)),
  );

  // Nodes
  app.get('/nodes', async () => adminInfra.listNodes());
  app.get('/nodes/:id', params, async (request) => adminInfra.nodeDetail(request.params.id));
  app.delete('/nodes/:id', params, async (request, reply) => {
    await adminInfra.deleteNode(request.params.id, actorOf(request));
    return reply.status(204).send();
  });

  // Connections & traffic
  app.get(
    '/connections',
    { schema: { querystring: adminConnectionsQuerySchema } },
    async (request) => adminInfra.listConnections(request.query),
  );
  app.delete('/connections/:id', params, async (request, reply) => {
    await adminInfra.terminateConnection(request.params.id, actorOf(request));
    return reply.status(204).send();
  });
  app.get('/traffic', { schema: { querystring: adminTrafficQuerySchema } }, async (request) =>
    adminInfra.traffic(request.query.from, request.query.to),
  );

  // Logs, security & settings
  app.get('/logs', { schema: { querystring: auditLogsQuerySchema } }, async (request) =>
    adminSecurity.auditLogs(request.query),
  );
  app.get(
    '/security/events',
    { schema: { querystring: securityEventsQuerySchema } },
    async (request) => adminSecurity.securityEvents(request.query),
  );
  app.post('/security/events/:id/resolve', params, async (request, reply) => {
    await adminSecurity.resolveEvent(request.params.id, actorOf(request));
    return reply.status(204).send();
  });
  app.get('/security/risk-flags', async () => adminSecurity.riskFlags());
  app.post(
    '/security/risk-flags',
    { schema: { body: riskFlagCreateSchema } },
    async (request, reply) => {
      await adminSecurity.createRiskFlag(request.body, actorOf(request));
      return reply.status(201).send({ created: true });
    },
  );
  app.post('/security/risk-flags/:id/resolve', params, async (request, reply) => {
    await adminSecurity.resolveRiskFlag(request.params.id, actorOf(request));
    return reply.status(204).send();
  });
  app.get('/settings', async () => adminSecurity.getSettings());
  app.patch('/settings', { schema: { body: settingsUpdateSchema } }, async (request) =>
    adminSecurity.updateSettings(request.body, actorOf(request)),
  );
}
