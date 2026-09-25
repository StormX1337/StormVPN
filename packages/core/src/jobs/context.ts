import type { Redis } from 'ioredis';
import type { Logger } from '@stormvpn/config';
import type { Database } from '@stormvpn/database';
import type { EventPublisher } from '../events';
import type { MailQueue } from '../queues';
import type { SettingsService } from '../settings';

export interface JobConfig {
  nodeOfflineAfterSeconds: number;
  connectionStaleAfterSeconds: number;
  heartbeatRetentionDays: number;
  auditRetentionDays: number;
  connectionRetentionDays: number;
}

export const DEFAULT_JOB_CONFIG: JobConfig = {
  nodeOfflineAfterSeconds: 90,
  connectionStaleAfterSeconds: 300,
  heartbeatRetentionDays: 7,
  auditRetentionDays: 365,
  connectionRetentionDays: 30,
};

export interface JobContext {
  db: Database;
  redis?: Redis;
  mail?: MailQueue;
  events?: EventPublisher;
  settings: SettingsService;
  logger: Logger;
  config: JobConfig;
  now?: () => Date;
}

export type JobResult = Record<string, number | string | boolean>;
export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export const nowOf = (ctx: JobContext): Date => (ctx.now ? ctx.now() : new Date());
