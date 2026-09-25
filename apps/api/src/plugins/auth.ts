import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { COOKIE_ACCESS_TOKEN } from '@stormvpn/config';
import type { Role } from '@stormvpn/database';
import { forbidden, unauthorized } from '../lib/errors';

/** Registers authentication/authorization preHandlers used by route modules. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  const { tokens, sessions } = app.services;

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const token = bearer ?? request.cookies[COOKIE_ACCESS_TOKEN];
    if (!token) throw unauthorized();

    const claims = await tokens.verifyAccessToken(token);
    const state = await sessions.getState(claims.sessionId);
    if (!state) throw unauthorized('session_revoked', 'Session expired, please sign in again');
    if (state.status !== 'ACTIVE') throw forbidden('account_suspended', 'This account has been suspended');

    request.auth = {
      userId: claims.userId,
      sessionId: claims.sessionId,
      role: state.role,
      emailVerified: state.emailVerified,
      via: bearer ? 'bearer' : 'cookie',
    };
    void sessions.touch(claims.sessionId).catch((error: unknown) => request.log.warn({ err: error }, 'session touch failed'));
  });

  app.decorate('requireVerifiedEmail', async (request: FastifyRequest) => {
    if (!request.auth) throw unauthorized();
    if (app.deps.env.REQUIRE_EMAIL_VERIFICATION && !request.auth.emailVerified) {
      throw forbidden('email_not_verified', 'Please verify your email address first');
    }
  });

  app.decorate('requireRole', (...roles: Role[]) => async (request: FastifyRequest) => {
    if (!request.auth) throw unauthorized();
    if (!roles.includes(request.auth.role)) throw forbidden();
  });
});
