import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { COOKIE_REFRESH_TOKEN } from '@stormvpn/config';
import type { LoginResultDto } from '@stormvpn/types';
import {
  forgotPasswordSchema,
  loginSchema,
  mfaLoginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';
import { unauthorized } from '../../lib/errors';
import { clientIp, isNativeClient, userAgent } from '../../lib/request';
import { toUserDto } from '../users/user.mapper';
import type { RequestMeta } from './auth.service';
import { clearSessionCookies, ensureCsrfCookie, respondWithSession } from './cookies';

function metaOf(request: FastifyRequest): RequestMeta {
  return {
    ipAddress: clientIp(request),
    userAgent: userAgent(request),
    clientType: isNativeClient(request) ? 'NATIVE' : 'WEB',
  };
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { env } = app.deps;
  const { auth, sessions } = app.services;
  const strict = { rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } };

  app.get('/csrf', async (request, reply) => ({
    csrfToken: ensureCsrfCookie(request, reply, env),
  }));

  app.post(
    '/register',
    { config: strict, schema: { body: registerSchema } },
    async (request, reply) => {
      const issued = await auth.register(request.body, metaOf(request));
      return reply.status(201).send(respondWithSession(request, reply, env, issued));
    },
  );

  app.post(
    '/login',
    { config: strict, schema: { body: loginSchema } },
    async (request, reply): Promise<LoginResultDto> => {
      const outcome = await auth.login(request.body, metaOf(request));
      if (outcome.kind === 'mfa') return { mfaRequired: true, mfaToken: outcome.mfaToken };
      return respondWithSession(request, reply, env, outcome.issued);
    },
  );

  app.post(
    '/login/mfa',
    { config: strict, schema: { body: mfaLoginSchema } },
    async (request, reply) => {
      const issued = await auth.completeMfaLogin(
        request.body.mfaToken,
        request.body.code,
        metaOf(request),
      );
      return respondWithSession(request, reply, env, issued);
    },
  );

  app.post(
    '/refresh',
    { config: strict, schema: { body: refreshSchema.nullish() } },
    async (request, reply) => {
      const token = request.body?.refreshToken ?? request.cookies[COOKIE_REFRESH_TOKEN];
      if (!token)
        throw unauthorized('missing_refresh_token', 'Session expired, please sign in again');
      try {
        const issued = await sessions.rotate(token, {
          ipAddress: clientIp(request),
          userAgent: userAgent(request),
        });
        return respondWithSession(request, reply, env, issued);
      } catch (error) {
        if (!isNativeClient(request) && (error as { code?: string }).code !== 'refresh_race') {
          clearSessionCookies(reply, env);
        }
        throw error;
      }
    },
  );

  app.post('/logout', { schema: { body: refreshSchema.nullish() } }, async (request, reply) => {
    const token = request.body?.refreshToken ?? request.cookies[COOKIE_REFRESH_TOKEN];
    if (token) await sessions.revokeByRefreshToken(token, 'logout');
    clearSessionCookies(reply, env);
    return reply.status(204).send();
  });

  app.post('/verify-email', { config: strict, schema: { body: tokenSchema } }, async (request) => {
    const user = await auth.verifyEmail(request.body.token);
    return { user: toUserDto(user) };
  });

  app.post(
    '/resend-verification',
    { preHandler: [app.authenticate], config: strict },
    async (request, reply) => {
      await auth.resendVerification(authOf(request).userId);
      return reply.status(202).send({ sent: true });
    },
  );

  app.post(
    '/forgot-password',
    { config: strict, schema: { body: forgotPasswordSchema } },
    async (request, reply) => {
      await auth.forgotPassword(request.body.email, metaOf(request));
      return reply.status(202).send({ sent: true });
    },
  );

  app.post(
    '/reset-password',
    { config: strict, schema: { body: resetPasswordSchema } },
    async (request, reply) => {
      await auth.resetPassword(request.body.token, request.body.password, metaOf(request));
      return reply.status(204).send();
    },
  );
}
