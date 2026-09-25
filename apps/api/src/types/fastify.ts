import 'fastify';

import type { Role } from '@stormvpn/database';
import type { AppDeps, Services } from '../container';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  emailVerified: boolean;
  via: 'cookie' | 'bearer';
}

export interface NodeContext {
  nodeId: string;
  serverId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    services: Services;
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireVerifiedEmail: (request: FastifyRequest) => Promise<void>;
    requireRole: (...roles: Role[]) => (request: FastifyRequest) => Promise<void>;
    authenticateNode: (request: FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    auth?: AuthContext;
    node?: NodeContext;
  }

  interface FastifyContextConfig {
    /** Disable CSRF enforcement (webhooks, node agent). */
    csrf?: boolean;
  }
}
