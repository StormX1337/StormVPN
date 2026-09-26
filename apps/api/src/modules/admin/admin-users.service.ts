import type { Redis } from 'ioredis';
import {
  type ActorContext,
  disconnectUser,
  getLiveSubscription,
  type MailQueue,
  reconcileUserPeers,
  revokeUserSessions,
  suspendUser,
  unsuspendUser,
  writeAuditLog,
} from '@stormvpn/core';
import type { Database, Prisma, Role } from '@stormvpn/database';
import type { AdminUserDto, Paginated } from '@stormvpn/types';
import type { PaginationQuery } from '@stormvpn/validation';
import type { Clock } from '../../lib/clock';
import { badRequest, notFound } from '../../lib/errors';
import { pageArgs, paginated } from '../../lib/pagination';
import type { SessionService } from '../auth/session.service';

export interface AdminUsersQuery extends PaginationQuery {
  search?: string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  role?: Role;
}

export class AdminUserService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly mail: MailQueue,
    private readonly clock: Clock,
  ) {}

  async list(query: AdminUsersQuery): Promise<Paginated<AdminUserDto>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: {
          _count: { select: { devices: true, connections: { where: { status: 'CONNECTED' } } } },
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
            include: { plan: { select: { name: true } } },
            take: 1,
          },
        },
      }),
      this.db.user.count({ where }),
    ]);
    return paginated(
      users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        twoFactorEnabled: user.totpEnabledAt !== null,
        riskScore: user.riskScore,
        suspendedReason: user.suspendedReason,
        planName: user.subscriptions[0]?.plan.name ?? null,
        subscriptionStatus: user.subscriptions[0]?.status ?? null,
        deviceCount: user._count.devices,
        activeConnections: user._count.connections,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async detail(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        devices: { orderBy: { createdAt: 'asc' } },
        subscriptions: {
          include: { plan: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        sessions: { where: { revokedAt: null }, orderBy: { lastUsedAt: 'desc' }, take: 20 },
        securityEvents: { orderBy: { createdAt: 'desc' }, take: 25 },
        riskFlags: { where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } },
        peers: { include: { server: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) throw notFound('User');
    const { passwordHash: _hash, totpSecretEnc: _secret, ...safe } = user;
    return {
      ...safe,
      peers: user.peers.map(({ presharedKeyEnc: _psk, rxBytes, txBytes, ...peer }) => ({
        ...peer,
        rxBytes: Number(rxBytes),
        txBytes: Number(txBytes),
      })),
      sessions: user.sessions.map(
        ({ refreshTokenHash: _r, previousRefreshTokenHash: _p, ...session }) => session,
      ),
    };
  }

  async suspend(userId: string, reason: string, actor: ActorContext): Promise<void> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User');
    if (user.id === actor.actorId)
      throw badRequest('cannot_suspend_self', 'You cannot suspend your own account');
    await suspendUser(this.db, this.redis, userId, reason, actor);
    await this.mail.send({ template: 'account-suspended', to: user.email, data: { reason } });
  }

  async unsuspend(userId: string, actor: ActorContext): Promise<void> {
    await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    await unsuspendUser(this.db, userId, actor);
    await this.sessions.refreshCache(userId);
  }

  async setRole(userId: string, role: Role, actor: ActorContext): Promise<void> {
    if (userId === actor.actorId)
      throw badRequest('cannot_change_own_role', 'You cannot change your own role');
    await this.db.user.update({ where: { id: userId }, data: { role } });
    await this.sessions.refreshCache(userId);
    await writeAuditLog(this.db, {
      ...actor,
      action: 'user.role',
      targetType: 'user',
      targetId: userId,
      metadata: { role },
    });
  }

  async revokeSessions(userId: string, actor: ActorContext): Promise<number> {
    const count = await revokeUserSessions(this.db, this.redis, userId, 'admin_revoked');
    await writeAuditLog(this.db, {
      ...actor,
      action: 'user.sessions.revoke',
      targetType: 'user',
      targetId: userId,
      metadata: { count },
    });
    return count;
  }

  async disconnect(userId: string, actor: ActorContext): Promise<number> {
    const count = await disconnectUser(this.db, userId, 'admin_terminated');
    await writeAuditLog(this.db, {
      ...actor,
      action: 'user.disconnect',
      targetType: 'user',
      targetId: userId,
      metadata: { count },
    });
    return count;
  }

  /** Complimentary / manual plan assignment (no payment provider). */
  async grantPlan(
    userId: string,
    planId: string,
    days: number | undefined,
    actor: ActorContext,
  ): Promise<void> {
    const plan = await this.db.plan.findUnique({ where: { id: planId } });
    if (!plan) throw notFound('Plan');
    const live = await getLiveSubscription(this.db, userId);
    if (live?.provider === 'STRIPE') {
      throw badRequest(
        'stripe_subscription_active',
        'Cancel the Stripe subscription before granting a plan',
      );
    }
    const now = this.clock.now();
    await this.db.$transaction(async (tx) => {
      if (live) {
        await tx.subscription.update({
          where: { id: live.id },
          data: { status: 'CANCELED', endedAt: now, canceledAt: now },
        });
      }
      await tx.subscription.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
          provider: 'NONE',
          currentPeriodStart: now,
          currentPeriodEnd: days ? new Date(now.getTime() + days * 86_400_000) : null,
        },
      });
    });
    await reconcileUserPeers(this.db, userId, now);
    await writeAuditLog(this.db, {
      ...actor,
      action: 'subscription.grant',
      targetType: 'user',
      targetId: userId,
      metadata: { planId, days },
    });
  }
}
