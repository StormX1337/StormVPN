import type { FastifyRequest } from 'fastify';
import { HEADER_CLIENT_TYPE } from '@stormvpn/config';

export function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export function userAgent(request: FastifyRequest): string | null {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : null;
}

/** Country provided by the edge (Cloudflare `CF-IPCountry`), when behind Cloudflare. */
export function edgeCountry(request: FastifyRequest): string | null {
  const header = request.headers['cf-ipcountry'];
  return typeof header === 'string' && /^[A-Z]{2}$/.test(header) && header !== 'XX' ? header : null;
}

/** Native clients (desktop/mobile apps) receive tokens in the body instead of cookies. */
export function isNativeClient(request: FastifyRequest): boolean {
  return request.headers[HEADER_CLIENT_TYPE] === 'native';
}

export function requestContext(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}
