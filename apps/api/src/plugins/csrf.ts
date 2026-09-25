import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { COOKIE_CSRF_TOKEN, HEADER_CLIENT_TYPE, HEADER_CSRF_TOKEN } from '@stormvpn/config';
import { safeEqual } from '@stormvpn/crypto/node';
import { forbidden } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF protection for browser (cookie-authenticated)
 * requests. Requests carrying an Authorization header or the native client
 * header cannot be forged cross-site (custom headers require a CORS preflight)
 * and are exempt.
 */
export function assertCsrf(request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (request.routeOptions.config?.csrf === false) return;
  if (request.headers.authorization || request.headers[HEADER_CLIENT_TYPE]) return;
  const cookieToken = request.cookies[COOKIE_CSRF_TOKEN];
  const headerToken = request.headers[HEADER_CSRF_TOKEN];
  if (!cookieToken || typeof headerToken !== 'string' || !safeEqual(cookieToken, headerToken)) {
    throw forbidden('csrf_invalid', 'Missing or invalid CSRF token');
  }
}

export const csrfPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('preValidation', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    assertCsrf(request);
  });
});
