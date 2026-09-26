import type { FastifyReply, FastifyRequest } from 'fastify';
import { COOKIE_ACCESS_TOKEN, COOKIE_CSRF_TOKEN, COOKIE_REFRESH_TOKEN, COOKIE_SESSION_HINT } from '@stormvpn/config';
import { generateToken } from '@stormvpn/crypto/node';
import type { AuthResultDto } from '@stormvpn/types';
import type { ApiEnv } from '../../env';
import { isNativeClient } from '../../lib/request';
import { toUserDto } from '../users/user.mapper';
import type { IssuedSession } from './session.service';

const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseCookie(env: Pick<ApiEnv, 'COOKIE_SECURE' | 'COOKIE_DOMAIN'>) {
  return { secure: env.COOKIE_SECURE, domain: env.COOKIE_DOMAIN, httpOnly: true } as const;
}

export function ensureCsrfCookie(request: FastifyRequest, reply: FastifyReply, env: ApiEnv): string {
  const existing = request.cookies[COOKIE_CSRF_TOKEN];
  if (existing && existing.length >= 32) return existing;
  const token = generateToken(32);
  void reply.setCookie(COOKIE_CSRF_TOKEN, token, {
    ...baseCookie(env),
    httpOnly: false,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}

/**
 * Browsers receive tokens as HttpOnly cookies (never readable by JavaScript);
 * native clients receive them in the body and store them in the OS keychain.
 */
export function respondWithSession(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ApiEnv,
  issued: IssuedSession,
): AuthResultDto {
  const user = toUserDto(issued.user);
  if (isNativeClient(request)) {
    return {
      user,
      tokens: {
        accessToken: issued.accessToken,
        accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
        refreshToken: issued.refreshToken,
        refreshTokenExpiresAt: issued.refreshTokenExpiresAt.toISOString(),
      },
    };
  }
  void reply.setCookie(COOKIE_ACCESS_TOKEN, issued.accessToken, {
    ...baseCookie(env),
    sameSite: 'lax',
    path: '/',
    expires: issued.accessTokenExpiresAt,
  });
  void reply.setCookie(COOKIE_REFRESH_TOKEN, issued.refreshToken, {
    ...baseCookie(env),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: issued.refreshTokenExpiresAt,
  });
  void reply.setCookie(COOKIE_SESSION_HINT, '1', {
    ...baseCookie(env),
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    expires: issued.refreshTokenExpiresAt,
  });
  ensureCsrfCookie(request, reply, env);
  return { user };
}

export function clearSessionCookies(reply: FastifyReply, env: ApiEnv): void {
  void reply.clearCookie(COOKIE_ACCESS_TOKEN, { ...baseCookie(env), path: '/' });
  void reply.clearCookie(COOKIE_REFRESH_TOKEN, { ...baseCookie(env), path: REFRESH_COOKIE_PATH });
  void reply.clearCookie(COOKIE_SESSION_HINT, { ...baseCookie(env), httpOnly: false, path: '/' });
}
