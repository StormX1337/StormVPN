import type { Redis } from 'ioredis';
import { LIVE_SUBSCRIPTION_STATUSES, type SettingsService, startOfUtcDay } from '@stormvpn/core';
import { type Database, toNumber } from '@stormvpn/database';
import type { AdminStatsDto } from '@stormvpn/types';
import type { Clock } from '../../lib/clock';
import { apiCounterKey } from '../../plugins/metrics';

const CACHE_KEY = 'stats:admin:overview';
const CACHE_SECONDS = 5;

/** Live KPIs for the admin dashboard, cached briefly so many open dashboards stay cheap. */
export class AdminStatsService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  async overview(): Promise<AdminStatsDto> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as AdminStatsDto;

    const now = this.clock.now();
    const [nodes, activeUsers, totalUsers, activeConnections, traffic, requests, errors, activeSubscriptions, settings] =
      await Promise.all([
        this.db.vPNNode.groupBy({ by: ['status'], _count: { _all: true } }),
        this.db.vPNConnection.findMany({ where: { status: 'CONNECTED' }, distinct: ['userId'], select: { userId: true } }),
        this.db.user.count({ where: { deletedAt: null } }),
        this.db.vPNConnection.count({ where: { status: 'CONNECTED' } }),
        this.db.trafficUsage.aggregate({ where: { day: startOfUtcDay(now) }, _sum: { rxBytes: true, txBytes: true } }),
        this.redis.get(apiCounterKey('requests', now)),
        this.redis.get(apiCounterKey('errors', now)),
        this.db.subscription.count({ where: { status: { in: LIVE_SUBSCRIPTION_STATUSES }, plan: { priceCents: { gt: 0 } } } }),
        this.settings.get(),
      ]);
    const countOf = (status: string) => nodes.find((group) => group.status === status)?._count._all ?? 0;
    const stats: AdminStatsDto = {
      onlineNodes: countOf('ONLINE'),
      totalNodes: nodes.reduce((sum, group) => sum + group._count._all, 0),
      degradedNodes: countOf('DEGRADED'),
      activeUsers: activeUsers.length,
      totalUsers,
      activeConnections,
      trafficTodayBytes: toNumber(traffic._sum.rxBytes) + toNumber(traffic._sum.txBytes),
      apiRequests: Number(requests ?? 0),
      apiErrors: Number(errors ?? 0),
      activeSubscriptions,
      maintenanceMode: settings.maintenanceMode,
      generatedAt: now.toISOString(),
    };
    await this.redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_SECONDS);
    return stats;
  }
}
