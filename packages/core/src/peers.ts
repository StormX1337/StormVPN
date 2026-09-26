import type { Database, DbClient } from '@stormvpn/database';
import { getEntitlements, getMonthlyTrafficBytes, isServerAllowed } from './entitlements';

/** Reasons set automatically by entitlement enforcement (reversible without admin action). */
export const AUTO_DISABLE_REASONS = [
  'SUSPENDED',
  'NO_SUBSCRIPTION',
  'TRAFFIC_LIMIT',
  'PLAN_RESTRICTION',
] as const;
export type AutoDisableReason = (typeof AUTO_DISABLE_REASONS)[number];
export const ADMIN_DISABLE_REASON = 'ADMIN';

/** Increments the desired-state revision so nodes pull a fresh peer list. */
export async function bumpPeerRevision(db: DbClient, serverIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(serverIds)];
  if (ids.length === 0) return;
  await db.vPNServer.updateMany({
    where: { id: { in: ids } },
    data: { peerRevision: { increment: 1 } },
  });
}

export interface ReconcileResult {
  disabled: number;
  enabled: number;
  reason: AutoDisableReason | null;
}

/**
 * Central entitlement enforcement: makes the user's WireGuard peers match what
 * they are allowed to use right now (account status, subscription, plan
 * restrictions, device limit, traffic allowance). Admin-disabled peers are left untouched.
 */
export async function reconcileUserPeers(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<ReconcileResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
  if (!user) return { disabled: 0, enabled: 0, reason: null };

  const entitlements = await getEntitlements(db, userId);
  let accountReason: AutoDisableReason | null = null;
  if (user.status !== 'ACTIVE' || user.deletedAt) accountReason = 'SUSPENDED';
  else if (!entitlements) accountReason = 'NO_SUBSCRIPTION';
  else if (entitlements.trafficLimitBytes !== null) {
    const used = await getMonthlyTrafficBytes(db, userId, now);
    if (used >= entitlements.trafficLimitBytes) accountReason = 'TRAFFIC_LIMIT';
  }

  const devices = await db.device.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const allowedDevices = new Set(
    devices.slice(0, entitlements?.maxDevices ?? 0).map((device) => device.id),
  );

  const peers = await db.vPNPeer.findMany({
    where: { userId },
    select: {
      id: true,
      status: true,
      disabledReason: true,
      deviceId: true,
      serverId: true,
      server: { select: { countryCode: true, serverClass: true } },
    },
  });

  const toDisable = new Map<AutoDisableReason, string[]>();
  const toEnable: string[] = [];
  const touchedServers = new Set<string>();

  for (const peer of peers) {
    let desired: AutoDisableReason | null = accountReason;
    if (!desired && entitlements) {
      if (!allowedDevices.has(peer.deviceId) || !isServerAllowed(entitlements, peer.server)) {
        desired = 'PLAN_RESTRICTION';
      }
    }
    const adminDisabled =
      peer.status === 'DISABLED' && peer.disabledReason === ADMIN_DISABLE_REASON;
    if (adminDisabled) continue;

    if (desired && (peer.status === 'ACTIVE' || peer.disabledReason !== desired)) {
      toDisable.set(desired, [...(toDisable.get(desired) ?? []), peer.id]);
      if (peer.status === 'ACTIVE') touchedServers.add(peer.serverId);
    } else if (!desired && peer.status === 'DISABLED') {
      toEnable.push(peer.id);
      touchedServers.add(peer.serverId);
    }
  }

  let disabled = 0;
  await db.$transaction(async (tx) => {
    for (const [reason, ids] of toDisable) {
      const result = await tx.vPNPeer.updateMany({
        where: { id: { in: ids } },
        data: { status: 'DISABLED', disabledReason: reason },
      });
      disabled += result.count;
    }
    if (toEnable.length > 0) {
      await tx.vPNPeer.updateMany({
        where: { id: { in: toEnable } },
        data: { status: 'ACTIVE', disabledReason: null },
      });
    }
    await bumpPeerRevision(tx, touchedServers);
  });

  return { disabled, enabled: toEnable.length, reason: accountReason };
}
