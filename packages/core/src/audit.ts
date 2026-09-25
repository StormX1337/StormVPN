import type { ActorType, DbClient } from '@stormvpn/database';

export interface AuditEntry {
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Append-only audit trail for administrative and security relevant actions. */
export async function writeAuditLog(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorType: entry.actorType,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: (entry.metadata ?? undefined) as never,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent?.slice(0, 512) ?? null,
    },
  });
}
