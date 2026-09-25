import type { Job } from 'bullmq';
import type { Logger } from '@stormvpn/config';
import { type EmailJob, type JobContext, MAINTENANCE_HANDLERS, type MaintenanceJobName } from '@stormvpn/core';
import type { Mailer } from './email/mailer';
import { renderEmail } from './email/templates';

export function createEmailProcessor(mailer: Mailer, appUrl: string, logger: Logger) {
  return async (job: Job<EmailJob>): Promise<void> => {
    const email = renderEmail(job.data, appUrl);
    await mailer.send(job.data.to, email);
    logger.info({ jobId: job.id, template: job.data.template }, 'email sent');
  };
}

export function createMaintenanceProcessor(ctx: JobContext) {
  return async (job: Job): Promise<Record<string, unknown>> => {
    const handler = MAINTENANCE_HANDLERS[job.name as MaintenanceJobName];
    if (!handler) throw new Error(`Unknown maintenance job ${job.name}`);
    const started = Date.now();
    const result = await handler(ctx);
    ctx.logger.info({ job: job.name, durationMs: Date.now() - started, result }, 'maintenance job finished');
    return result;
  };
}
