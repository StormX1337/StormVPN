import type { Redis } from 'ioredis';
import { generateToken, hashPassword, verifyPassword } from '@stormvpn/crypto/node';
import {
  type MailQueue,
  recordSecurityEvent,
  revokeUserSessions,
  writeAuditLog,
} from '@stormvpn/core';
import type { Database, User } from '@stormvpn/database';
import type { SecurityEventDto, SessionDto } from '@stormvpn/types';
import type { UpdateProfileInput } from '@stormvpn/validation';
import type { Clock } from '../../lib/clock';
import { badRequest, notFound } from '../../lib/errors';
import type { SessionService } from '../auth/session.service';

export interface AccountDeletionHook {
  beforeAccountDeletion(userId: string): Promise<void>;
}

export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly mail: MailQueue,
    private readonly clock: Clock,
    private readonly deletionHooks: AccountDeletionHook[] = [],
  ) {}

  async getUser(userId: string): Promise<User> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw notFound('User');
    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    return this.db.user.update({ where: { id: userId }, data: input });
  }

  async assertPassword(user: User, password: string): Promise<void> {
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw badRequest('invalid_password', 'Current password is incorrect');
    }
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    meta: { ipAddress: string; userAgent: string | null },
  ): Promise<void> {
    const user = await this.getUser(userId);
    await this.assertPassword(user, currentPassword);
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await revokeUserSessions(this.db, this.redis, userId, 'password_changed', currentSessionId);
    await recordSecurityEvent(this.db, {
      userId,
      type: 'PASSWORD_CHANGED',
      severity: 'MEDIUM',
      ...meta,
    });
    await this.mail.send({
      template: 'password-changed',
      to: user.email,
      data: { time: this.clock.now().toISOString() },
    });
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionDto[]> {
    const sessions = await this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: this.clock.now() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      clientType: session.clientType,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.db.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw notFound('Session');
    await this.sessions.revoke(session.id, 'user_revoked');
    await recordSecurityEvent(this.db, {
      userId,
      type: 'SESSION_REVOKED',
      metadata: { sessionId },
    });
  }

  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    const count = await revokeUserSessions(
      this.db,
      this.redis,
      userId,
      'user_revoked_all',
      currentSessionId,
    );
    await recordSecurityEvent(this.db, { userId, type: 'SESSION_REVOKED', metadata: { count } });
    return count;
  }

  async listSecurityEvents(userId: string, limit = 50): Promise<SecurityEventDto[]> {
    const events = await this.db.securityEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return events.map((event) => ({
      id: event.id,
      type: event.type as SecurityEventDto['type'],
      severity: event.severity,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  /**
   * GDPR deletion: personal data is removed/anonymised, VPN access revoked.
   * Invoices and payments are retained (anonymised user) for statutory accounting.
   */
  async deleteAccount(
    userId: string,
    password: string,
    meta: { ipAddress: string; userAgent: string | null },
  ): Promise<void> {
    const user = await this.getUser(userId);
    await this.assertPassword(user, password);
    for (const hook of this.deletionHooks) await hook.beforeAccountDeletion(userId);

    const peers = await this.db.vPNPeer.findMany({ where: { userId }, select: { serverId: true } });
    await revokeUserSessions(this.db, this.redis, userId, 'account_deleted');
    await this.db.$transaction(async (tx) => {
      await tx.vPNConnection.updateMany({
        where: { userId, status: { in: ['CONNECTING', 'CONNECTED'] } },
        data: {
          status: 'DISCONNECTED',
          endedAt: this.clock.now(),
          disconnectReason: 'account_deleted',
        },
      });
      await tx.device.deleteMany({ where: { userId } });
      await tx.userFavorite.deleteMany({ where: { userId } });
      await tx.backupCode.deleteMany({ where: { userId } });
      await tx.subscription.updateMany({
        where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        data: { status: 'CANCELED', endedAt: this.clock.now(), canceledAt: this.clock.now() },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@deleted.invalid`,
          name: null,
          passwordHash: await hashPassword(generateToken(32)),
          totpSecretEnc: null,
          totpEnabledAt: null,
          lastLoginIp: null,
          preferredCountry: null,
          status: 'SUSPENDED',
          suspendedReason: 'account_deleted',
          deletedAt: this.clock.now(),
        },
      });
      await tx.vPNServer.updateMany({
        where: { id: { in: [...new Set(peers.map((peer) => peer.serverId))] } },
        data: { peerRevision: { increment: 1 } },
      });
    });
    await writeAuditLog(this.db, {
      actorId: userId,
      actorType: 'USER',
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
      ...meta,
    });
  }
}
