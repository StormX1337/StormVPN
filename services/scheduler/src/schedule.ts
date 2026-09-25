import type { Queue } from 'bullmq';
import { MAINTENANCE_JOBS, MAINTENANCE_SCHEDULE } from '@stormvpn/core';

export interface ScheduleEntry {
  name: string;
  everyMs: number;
}

export function buildSchedule(overrides: Partial<Record<string, number>> = {}): ScheduleEntry[] {
  return MAINTENANCE_JOBS.map((name) => ({ name, everyMs: overrides[name] ?? MAINTENANCE_SCHEDULE[name] }));
}

/**
 * Registers repeatable maintenance jobs. `upsertJobScheduler` is idempotent,
 * so any number of scheduler replicas can run safely; the worker executes them.
 */
export async function applySchedule(queue: Queue, entries: ScheduleEntry[]): Promise<string[]> {
  const wanted = new Set(entries.map((entry) => entry.name));
  for (const entry of entries) {
    await queue.upsertJobScheduler(entry.name, { every: entry.everyMs }, { name: entry.name, data: {} });
  }
  const removed: string[] = [];
  for (const scheduler of await queue.getJobSchedulers()) {
    if (scheduler.key && !wanted.has(scheduler.key)) {
      await queue.removeJobScheduler(scheduler.key);
      removed.push(scheduler.key);
    }
  }
  return removed;
}
