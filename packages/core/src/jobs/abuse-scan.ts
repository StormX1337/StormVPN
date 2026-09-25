import type { SecurityEventType } from '@stormvpn/types';
import { suspendUser } from '../account-actions';
import { recordSecurityEvent, SECURITY_EVENT_RISK } from '../security-events';
import { HOUR } from '../time';
import type { JobContext, JobResult } from './context';
import { nowOf } from './context';

export interface RiskSignals {
  eventCounts: Partial<Record<SecurityEventType, number>>;
  flagScore: number;
  concurrentConnections: number;
  maxSessions: number;
  distinctServersLastHour: number;
}

/**
 * Pure risk scoring so the heuristics are unit-testable.
 * Scores decay naturally because only the last 24h of events are considered.
 */
export function computeRiskScore(signals: RiskSignals): number {
  let score = signals.flagScore;
  for (const [type, count] of Object.entries(signals.eventCounts)) {
    score += (SECURITY_EVENT_RISK[type as SecurityEventType] ?? 0) * (count ?? 0);
  }
  const excessConnections = Math.max(0, signals.concurrentConnections - signals.maxSessions);
  score += excessConnections * 10;
  if (signals.distinctServersLastHour > 10) score += (signals.distinctServersLastHour - 10) * 5;
  return Math.round(score);
}

/**
 * Periodic abuse monitoring: aggregates security signals per user, stores the
 * risk score and automatically suspends accounts above the configured threshold.
 */
export async function runAbuseScan(ctx: JobContext): Promise<JobResult> {
  const now = nowOf(ctx);
  const since = new Date(now.getTime() - 24 * HOUR);
  const settings = await ctx.settings.get();

  const events = await ctx.db.securityEvent.groupBy({
    by: ['userId', 'type'],
    where: { createdAt: { gte: since }, userId: { not: null } },
    _count: { _all: true },
  });
  const flags = await ctx.db.riskFlag.groupBy({
    by: ['userId'],
    where: { resolvedAt: null, userId: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    _sum: { score: true },
  });
  const connections = await ctx.db.vPNConnection.groupBy({
    by: ['userId'],
    where: { status: 'CONNECTED' },
    _count: { _all: true },
  });
  const recentServers = await ctx.db.vPNConnection.groupBy({
    by: ['userId', 'serverId'],
    where: { startedAt: { gte: new Date(now.getTime() - HOUR) } },
  });

  const signals = new Map<string, RiskSignals>();
  const get = (userId: string): RiskSignals => {
    let entry = signals.get(userId);
    if (!entry) {
      entry = { eventCounts: {}, flagScore: 0, concurrentConnections: 0, maxSessions: Infinity, distinctServersLastHour: 0 };
      signals.set(userId, entry);
    }
    return entry;
  };
  for (const row of events) {
    get(row.userId!).eventCounts[row.type as SecurityEventType] = row._count._all;
  }
  for (const row of flags) get(row.userId!).flagScore = row._sum.score ?? 0;
  for (const row of connections) get(row.userId).concurrentConnections = row._count._all;
  for (const row of recentServers) get(row.userId).distinctServersLastHour++;

  const userIds = [...signals.keys()];
  const users = await ctx.db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      riskScore: true,
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        select: { plan: { select: { maxSessions: true } } },
        take: 1,
      },
    },
  });

  let scored = 0;
  let suspended = 0;
  for (const user of users) {
    const signal = signals.get(user.id)!;
    signal.maxSessions = user.subscriptions[0]?.plan.maxSessions ?? 0;
    const score = computeRiskScore(signal);
    if (score !== user.riskScore) {
      await ctx.db.user.update({ where: { id: user.id }, data: { riskScore: score } });
      scored++;
    }
    const canSuspend = user.role === 'USER' && user.status === 'ACTIVE';
    if (canSuspend && score >= settings.abuseAutoSuspendScore) {
      await recordSecurityEvent(ctx.db, {
        userId: user.id,
        type: 'ABUSE_SUSPECTED',
        severity: 'CRITICAL',
        metadata: { score, threshold: settings.abuseAutoSuspendScore, signals: { ...signal, maxSessions: signal.maxSessions } },
      });
      await suspendUser(ctx.db, ctx.redis, user.id, 'Automated abuse protection', {
        actorId: null,
        actorType: 'SYSTEM',
      });
      await ctx.mail?.send({ template: 'account-suspended', to: user.email, data: { reason: 'automated abuse protection' } });
      await ctx.events?.toUser(user.id, { type: 'account.suspended', data: { reason: 'Automated abuse protection' } });
      suspended++;
      ctx.logger.warn({ userId: user.id, score }, 'account automatically suspended');
    }
  }
  return { evaluated: users.length, scored, suspended };
}
