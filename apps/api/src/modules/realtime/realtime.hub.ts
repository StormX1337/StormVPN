import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { CHANNEL_ADMIN_EVENTS, CHANNEL_USER_EVENTS, type Logger } from '@stormvpn/config';
import type { RealtimeMessage } from '@stormvpn/types';
import type { AdminStatsService } from '../admin/stats.service';

const ADMIN_STATS_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

type TrackedSocket = WebSocket & { isAlive?: boolean };

/**
 * Per-instance WebSocket registry. Events are published to Redis by any API
 * replica, worker or scheduler and fanned out here to locally connected clients.
 */
export class RealtimeHub {
  private readonly users = new Map<string, Set<TrackedSocket>>();
  private readonly admins = new Set<TrackedSocket>();
  private statsTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly subscriber: Redis,
    private readonly stats: AdminStatsService,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await this.subscriber.subscribe(CHANNEL_USER_EVENTS, CHANNEL_ADMIN_EVENTS);
    this.subscriber.on('message', (channel: string, raw: string) => {
      try {
        const payload = JSON.parse(raw) as { userId?: string; message: RealtimeMessage };
        if (channel === CHANNEL_USER_EVENTS && payload.userId) this.sendToUser(payload.userId, payload.message);
        if (channel === CHANNEL_ADMIN_EVENTS) this.broadcastAdmins(payload.message);
      } catch (error) {
        this.logger.warn({ err: error }, 'invalid realtime payload');
      }
    });
    this.statsTimer = setInterval(() => void this.pushStats(), ADMIN_STATS_INTERVAL_MS);
    this.pingTimer = setInterval(() => this.pingAll(), HEARTBEAT_INTERVAL_MS);
    this.statsTimer.unref();
    this.pingTimer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.statsTimer);
    clearInterval(this.pingTimer);
    for (const socket of this.allSockets()) socket.close(1001, 'server shutting down');
    await this.subscriber.quit().catch(() => undefined);
  }

  register(socket: TrackedSocket, userId: string, admin: boolean): void {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    const set = this.users.get(userId) ?? new Set();
    set.add(socket);
    this.users.set(userId, set);
    if (admin) this.admins.add(socket);
    socket.on('close', () => {
      set.delete(socket);
      if (set.size === 0) this.users.delete(userId);
      this.admins.delete(socket);
    });
    this.send(socket, { type: 'hello', data: { userId, admin } });
    if (admin) void this.pushStats(socket);
  }

  get connectionCount(): number {
    let count = 0;
    for (const set of this.users.values()) count += set.size;
    return count;
  }

  private *allSockets(): Iterable<TrackedSocket> {
    for (const set of this.users.values()) yield* set;
  }

  private send(socket: TrackedSocket, message: RealtimeMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  sendToUser(userId: string, message: RealtimeMessage): void {
    for (const socket of this.users.get(userId) ?? []) this.send(socket, message);
  }

  private broadcastAdmins(message: RealtimeMessage): void {
    for (const socket of this.admins) this.send(socket, message);
  }

  private async pushStats(target?: TrackedSocket): Promise<void> {
    if (this.admins.size === 0) return;
    try {
      const data = await this.stats.overview();
      if (target) this.send(target, { type: 'admin.stats', data });
      else this.broadcastAdmins({ type: 'admin.stats', data });
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to compute admin stats');
    }
  }

  private pingAll(): void {
    for (const socket of this.allSockets()) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }
}
