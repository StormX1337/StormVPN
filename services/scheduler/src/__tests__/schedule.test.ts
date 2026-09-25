import { describe, expect, it } from 'vitest';
import { MAINTENANCE_HANDLERS } from '@stormvpn/core';
import { applySchedule, buildSchedule } from '../schedule';

describe('maintenance schedule', () => {
  it('schedules every maintenance handler with a sane interval', () => {
    const schedule = buildSchedule();
    expect(schedule.map((entry) => entry.name).sort()).toEqual(Object.keys(MAINTENANCE_HANDLERS).sort());
    for (const entry of schedule) expect(entry.everyMs).toBeGreaterThanOrEqual(10_000);
  });

  it('upserts schedulers and removes obsolete ones', async () => {
    const upserted: string[] = [];
    const removed: string[] = [];
    const queue = {
      upsertJobScheduler: async (name: string) => void upserted.push(name),
      getJobSchedulers: async () => [{ key: 'node-health' }, { key: 'legacy-job' }],
      removeJobScheduler: async (key: string) => void removed.push(key),
    };
    const result = await applySchedule(queue as never, buildSchedule({ 'node-health': 15_000 }));
    expect(upserted).toContain('node-health');
    expect(result).toEqual(['legacy-job']);
    expect(removed).toEqual(['legacy-job']);
  });
});
