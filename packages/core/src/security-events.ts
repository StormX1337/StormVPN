import type { DbClient, Severity } from '@stormvpn/database';
import type { SecurityEventType } from '@stormvpn/types';

export interface SecurityEventInput {
  userId?: string | null;
  type: SecurityEventType;
  severity?: Severity;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

const DEFAULT_SEVERITY: Partial<Record<SecurityEventType, Severity>> = {
  LOGIN_FAILED: 'LOW',
  LOGIN_LOCKED: 'MEDIUM',
  MFA_FAILED: 'MEDIUM',
  REFRESH_TOKEN_REUSE: 'HIGH',
  ACCOUNT_SUSPENDED: 'HIGH',
  RATE_LIMITED: 'LOW',
  DEVICE_LIMIT_REACHED: 'LOW',
  CONNECTION_LIMIT_REACHED: 'LOW',
  TRAFFIC_LIMIT_REACHED: 'INFO',
  ABUSE_SUSPECTED: 'HIGH',
  NODE_AUTH_FAILED: 'MEDIUM',
  SERVER_KILL_SWITCH: 'CRITICAL',
};

/** Risk points contributed by each event type to a user's abuse score. */
export const SECURITY_EVENT_RISK: Partial<Record<SecurityEventType, number>> = {
  LOGIN_FAILED: 1,
  LOGIN_LOCKED: 5,
  MFA_FAILED: 3,
  RATE_LIMITED: 2,
  DEVICE_LIMIT_REACHED: 2,
  CONNECTION_LIMIT_REACHED: 3,
  REFRESH_TOKEN_REUSE: 20,
  ABUSE_SUSPECTED: 25,
};

export async function recordSecurityEvent(db: DbClient, event: SecurityEventInput): Promise<void> {
  await db.securityEvent.create({
    data: {
      userId: event.userId ?? null,
      type: event.type,
      severity: event.severity ?? DEFAULT_SEVERITY[event.type] ?? 'INFO',
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent?.slice(0, 512) ?? null,
      metadata: (event.metadata ?? undefined) as never,
    },
  });
}
