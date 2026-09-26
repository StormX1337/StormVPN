import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { QUEUE_EMAIL, QUEUE_MAINTENANCE } from '@stormvpn/config';

export type EmailTemplate =
  | 'verify-email'
  | 'password-reset'
  | 'password-changed'
  | 'welcome'
  | 'new-login'
  | 'payment-failed'
  | 'subscription-canceled'
  | 'trial-ending'
  | 'account-suspended'
  | 'traffic-limit-reached';

export interface EmailJob {
  template: EmailTemplate;
  to: string;
  data: Record<string, string | number | null>;
}

export const MAINTENANCE_JOBS = [
  'node-health',
  'connection-reaper',
  'traffic-enforcement',
  'subscription-lifecycle',
  'cleanup',
  'abuse-scan',
] as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[number];

/** Default schedules (every N milliseconds) registered by the scheduler. */
export const MAINTENANCE_SCHEDULE: Record<MaintenanceJobName, number> = {
  'node-health': 30_000,
  'connection-reaper': 60_000,
  'traffic-enforcement': 60_000,
  'subscription-lifecycle': 5 * 60_000,
  cleanup: 60 * 60_000,
  'abuse-scan': 10 * 60_000,
};

/** Abstraction used by the API so tests can capture emails without Redis. */
export interface MailQueue {
  send(job: EmailJob): Promise<void>;
}

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export class BullMailQueue implements MailQueue {
  private readonly queue: Queue<EmailJob>;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue<EmailJob>(QUEUE_EMAIL, { connection, defaultJobOptions });
  }

  async send(job: EmailJob): Promise<void> {
    await this.queue.add(job.template, job);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createMaintenanceQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_MAINTENANCE, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
}
