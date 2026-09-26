import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { recordSecurityEvent } from '@stormvpn/core';
import type { PublicIpDto } from '@stormvpn/types';
import {
  changePasswordSchema,
  deleteAccountSchema,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  idParamsSchema,
  regenerateBackupCodesSchema,
  updateProfileSchema,
} from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';
import { badRequest } from '../../lib/errors';
import { clientIp, edgeCountry, requestContext } from '../../lib/request';
import { clearSessionCookies } from '../auth/cookies';
import { toUserDto } from '../users/user.mapper';

/** `/api/v1/user` – profile of the signed-in user. */
export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { account } = app.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => toUserDto(await account.getUser(authOf(request).userId)));

  app.patch('/', { schema: { body: updateProfileSchema } }, async (request) => {
    return toUserDto(await account.updateProfile(authOf(request).userId, request.body));
  });

  app.get('/ip', async (request): Promise<PublicIpDto> => {
    const ip = clientIp(request);
    const server = await app.deps.db.vPNServer.findFirst({
      where: { OR: [{ publicIpv4: ip }, { publicIpv6: ip }] },
      select: { countryCode: true },
    });
    return { ip, country: server?.countryCode ?? edgeCountry(request), protected: server !== null };
  });
}

/** `/api/v1/account` – security settings. */
export async function accountRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { account, mfa } = app.services;
  const { env } = app.deps;
  app.addHook('preHandler', app.authenticate);
  const sensitive = { rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } };

  app.post(
    '/password',
    { config: sensitive, schema: { body: changePasswordSchema } },
    async (request, reply) => {
      const auth = authOf(request);
      await account.changePassword(
        auth.userId,
        auth.sessionId,
        request.body.currentPassword,
        request.body.newPassword,
        requestContext(request),
      );
      return reply.status(204).send();
    },
  );

  app.post('/2fa/setup', async (request) =>
    mfa.beginSetup(await account.getUser(authOf(request).userId)),
  );

  app.post(
    '/2fa/enable',
    { config: sensitive, schema: { body: enableTwoFactorSchema } },
    async (request) => {
      const user = await account.getUser(authOf(request).userId);
      return { backupCodes: await mfa.enable(user, request.body.code) };
    },
  );

  app.post(
    '/2fa/disable',
    { config: sensitive, schema: { body: disableTwoFactorSchema } },
    async (request, reply) => {
      const user = await account.getUser(authOf(request).userId);
      await account.assertPassword(user, request.body.password);
      if (!(await mfa.verify(user, request.body.code))) {
        await recordSecurityEvent(app.deps.db, {
          userId: user.id,
          type: 'MFA_FAILED',
          ...requestContext(request),
        });
        throw badRequest('invalid_mfa_code', 'Invalid verification code');
      }
      await mfa.disable(user);
      return reply.status(204).send();
    },
  );

  app.post(
    '/2fa/backup-codes',
    { config: sensitive, schema: { body: regenerateBackupCodesSchema } },
    async (request) => {
      const user = await account.getUser(authOf(request).userId);
      if (!(await mfa.verify(user, request.body.code)))
        throw badRequest('invalid_mfa_code', 'Invalid verification code');
      return { backupCodes: await mfa.regenerateBackupCodes(user) };
    },
  );

  app.get('/sessions', async (request) => {
    const auth = authOf(request);
    return account.listSessions(auth.userId, auth.sessionId);
  });

  app.delete('/sessions/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await account.revokeSession(authOf(request).userId, request.params.id);
    return reply.status(204).send();
  });

  app.delete('/sessions', async (request) => {
    const auth = authOf(request);
    return { revoked: await account.revokeOtherSessions(auth.userId, auth.sessionId) };
  });

  app.get('/security-events', async (request) =>
    account.listSecurityEvents(authOf(request).userId),
  );

  app.delete(
    '/',
    { config: sensitive, schema: { body: deleteAccountSchema } },
    async (request, reply) => {
      await account.deleteAccount(
        authOf(request).userId,
        request.body.password,
        requestContext(request),
      );
      clearSessionCookies(reply, env);
      return reply.status(204).send();
    },
  );
}
