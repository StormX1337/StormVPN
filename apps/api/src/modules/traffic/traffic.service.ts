import { addDays, getEntitlements, isoDay, startOfUtcDay, startOfUtcMonth } from '@stormvpn/core';
import { type Database, toNullableNumber, toNumber } from '@stormvpn/database';
import type { TrafficSummaryDto } from '@stormvpn/types';
import type { Clock } from '../../lib/clock';

export class TrafficService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async summary(userId: string, days: number): Promise<TrafficSummaryDto> {
    const now = this.clock.now();
    const monthStart = startOfUtcMonth(now);
    const from = addDays(startOfUtcDay(now), -(days - 1));
    const [month, daily, entitlements] = await Promise.all([
      this.db.trafficUsage.aggregate({
        where: { userId, day: { gte: monthStart } },
        _sum: { rxBytes: true, txBytes: true },
      }),
      this.db.trafficUsage.groupBy({
        by: ['day'],
        where: { userId, day: { gte: from } },
        _sum: { rxBytes: true, txBytes: true },
        orderBy: { day: 'asc' },
      }),
      getEntitlements(this.db, userId),
    ]);

    const byDay = new Map(daily.map((row) => [isoDay(row.day), row._sum]));
    const points = Array.from({ length: days }, (_, index) => {
      const date = isoDay(addDays(from, index));
      const sum = byDay.get(date);
      return { date, rxBytes: toNumber(sum?.rxBytes), txBytes: toNumber(sum?.txBytes) };
    });
    return {
      periodStart: monthStart.toISOString(),
      rxBytes: toNumber(month._sum.rxBytes),
      txBytes: toNumber(month._sum.txBytes),
      limitBytes: toNullableNumber(entitlements?.trafficLimitBytes),
      daily: points,
    };
  }
}
