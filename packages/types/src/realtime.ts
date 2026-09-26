import type { AdminNodeDto, AdminStatsDto } from './dto/admin';
import type { ConnectionDto } from './dto/vpn';

/** Messages pushed to clients over the WebSocket channel `/api/v1/ws`. */
export type RealtimeMessage =
  | { type: 'hello'; data: { userId: string; admin: boolean } }
  | { type: 'connection.updated'; data: ConnectionDto }
  | { type: 'traffic.updated'; data: { connectionId: string; rxBytes: number; txBytes: number } }
  | { type: 'account.suspended'; data: { reason: string } }
  | { type: 'admin.stats'; data: AdminStatsDto }
  | {
      type: 'admin.node';
      data: Pick<
        AdminNodeDto,
        'id' | 'serverId' | 'serverName' | 'status' | 'metrics' | 'lastHeartbeatAt'
      >;
    }
  | { type: 'pong'; data: { ts: number } };

export type RealtimeMessageType = RealtimeMessage['type'];

/** Messages accepted from clients. */
export type RealtimeClientMessage = { type: 'ping' } | { type: 'subscribe'; channel: 'admin' };
