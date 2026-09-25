import type { Redis } from 'ioredis';
import type { ActorType, Database } from '@stormvpn/database';
import { writeAuditLog } from './audit';
import { recordSecurityEvent } from './security-events';
import { reconcileUserPeers } from './peers';

export const SESSION_CACHE_PREFIX = 'sess:';

/** Invalidates cached session validity so revocation takes effect immediately on every API replica. */
export async function invalidateSessionCache(redis: Redis | undefined, sessionIds: string[]): Promise<void> {
  if (!redis || sessionIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const id of sessionIds) pipeline.set(`${SESSION_CACHE_PREFIX}${id}`, '0', 'EX', 3600);
  await pipeline.exec();
}

export async function revokeUserSessions(
  db: Database,
  redis: Redis | undefined,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    select: { id: true },
  });
  const ids = sessions.map((session) => session.id);
  if (ids.length === 0) return 0;
  await db.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date(), revokedReason: reason } });
  await invalidateSessionCache(redis, ids);
  return ids.length;
}

/** Ends all live VPN connections of a user (does not delete peers). */
export async function disconnectUser(db: Database, userId: string, reason: string): Promise<number> {
  const result = await db.vPNConnection.updateMany({
    where: { userId, status: { in: ['CONNECTING', 'CONNECTED'] } },
    data: { status: 'DISCONNECTED', endedAt: new Date(), disconnectReason: reason },
  });
  return result.count;
}

export interface ActorContext {
  actorId: string | null;
  actorType: ActorType;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function suspendUser(
  db: Database,
  redis: Redis | undefined,
  userId: string,
  reason: string,
  actor: ActorContext,
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: reason },
  });
  await revokeUserSessions(db, redis, userId, 'account_suspended');
  await disconnectUser(db, userId, 'account_suspended');
  await reconcileUserPeers(db, userId);
  await recordSecurityEvent(db, {
    userId,
    type: 'ACCOUNT_SUSPENDED',
    ipAddress: actor.ipAddress ?? null,
    metadata: { reason, actorType: actor.actorType },
  });
  await writeAuditLog(db, {
    ...actor,
    action: 'user.suspend',
    targetType: 'user',
    targetId: userId,
    metadata: { reason },
  });
}

export async function unsuspendUser(db: Database, userId: string, actor: ActorContext): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null, riskScore: 0 },
  });
  await reconcileUserPeers(db, userId);
  await recordSecurityEvent(db, { userId, type: 'ACCOUNT_UNSUSPENDED', metadata: { actorType: actor.actorType } });
  await writeAuditLog(db, { ...actor, action: 'user.unsuspend', targetType: 'user', targetId: userId });
}
