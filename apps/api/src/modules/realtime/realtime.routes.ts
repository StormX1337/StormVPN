import type { FastifyInstance } from 'fastify';
import type { RealtimeClientMessage } from '@stormvpn/types';
import { authOf } from '../../lib/auth-context';

const MAX_MESSAGE_BYTES = 1024;

/**
 * `GET /api/v1/ws` – authenticated WebSocket for live connection status (users)
 * and live KPIs / node telemetry (admins). Browsers authenticate with the
 * session cookie, native clients with `Authorization: Bearer`.
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  const { realtime } = app.services;

  app.get(
    '/ws',
    {
      websocket: true,
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    (socket, request) => {
      const auth = authOf(request);
      realtime.register(socket, auth.userId, auth.role === 'ADMIN' || auth.role === 'SUPPORT');
      socket.on('message', (raw: Buffer) => {
        if (raw.length > MAX_MESSAGE_BYTES) return socket.close(1009, 'message too large');
        try {
          const message = JSON.parse(raw.toString()) as RealtimeClientMessage;
          if (message.type === 'ping')
            socket.send(JSON.stringify({ type: 'pong', data: { ts: Date.now() } }));
        } catch {
          socket.close(1003, 'invalid message');
        }
      });
    },
  );
}
