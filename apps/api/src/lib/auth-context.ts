import type { FastifyRequest } from 'fastify';
import type { AuthContext, NodeContext } from '../types/fastify';
import { unauthorized } from './errors';

/** Returns the authenticated user context (routes must use the authenticate preHandler). */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function nodeOf(request: FastifyRequest): NodeContext {
  if (!request.node) throw unauthorized('node_unauthorized', 'Node authentication required');
  return request.node;
}
