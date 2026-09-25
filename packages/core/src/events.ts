import type { Redis } from 'ioredis';
import { CHANNEL_ADMIN_EVENTS, CHANNEL_USER_EVENTS } from '@stormvpn/config';
import type { RealtimeMessage } from '@stormvpn/types';

/** Publishes realtime events; every API replica fans them out to its WebSocket clients. */
export interface EventPublisher {
  toUser(userId: string, message: RealtimeMessage): Promise<void>;
  toAdmins(message: RealtimeMessage): Promise<void>;
}

export class RedisEventPublisher implements EventPublisher {
  constructor(private readonly redis: Redis) {}

  async toUser(userId: string, message: RealtimeMessage): Promise<void> {
    await this.redis.publish(CHANNEL_USER_EVENTS, JSON.stringify({ userId, message }));
  }

  async toAdmins(message: RealtimeMessage): Promise<void> {
    await this.redis.publish(CHANNEL_ADMIN_EVENTS, JSON.stringify({ message }));
  }
}

export class NoopEventPublisher implements EventPublisher {
  async toUser(): Promise<void> {}
  async toAdmins(): Promise<void> {}
}
