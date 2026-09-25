import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { sha256Hex } from '@stormvpn/crypto/node';
import { recordSecurityEvent } from '@stormvpn/core';
import type { Database } from '@stormvpn/database';
import { tooManyRequests, unauthorized } from '../../lib/errors';

const FAILURE_LIMIT = 20;
const FAILURE_WINDOW_SECONDS = 600;

/**
 * Node agents authenticate with `Authorization: Bearer snt_…`. Only the SHA-256
 * hash of the token is stored; repeated failures from an IP are throttled and
 * recorded as security events.
 */
export const nodeAuthPlugin = fp(async (app: FastifyInstance, opts: { db: Database; redis: Redis }) => {
  app.decorate('authenticateNode', async (request: FastifyRequest) => {
    const failureKey = `node:authfail:${request.ip}`;
    const failures = Number((await opts.redis.get(failureKey)) ?? 0);
    if (failures >= FAILURE_LIMIT) throw tooManyRequests('node_auth_throttled', 'Too many failed node authentications');

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer snt_') ? header.slice(7).trim() : null;
    const node = token
      ? await opts.db.vPNNode.findUnique({ where: { tokenHash: sha256Hex(token) }, select: { id: true, serverId: true } })
      : null;
    if (!node) {
      const count = await opts.redis.multi().incr(failureKey).expire(failureKey, FAILURE_WINDOW_SECONDS).exec();
      if (Number(count?.[0]?.[1]) === 5) {
        await recordSecurityEvent(opts.db, { type: 'NODE_AUTH_FAILED', ipAddress: request.ip });
      }
      throw unauthorized('node_unauthorized', 'Invalid node token');
    }
    request.node = { nodeId: node.id, serverId: node.serverId };
  });
});
