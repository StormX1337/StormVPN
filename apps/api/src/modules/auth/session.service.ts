import type { Redis } from 'ioredis';
import { sha256Hex } from '@stormvpn/crypto/node';
import { invalidateSessionCache, recordSecurityEvent, SESSION_CACHE_PREFIX } from '@stormvpn/core';
import type { ClientType, Database, Role, Session, User, UserStatus } from '@stormvpn/database';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import { unauthorized } from '../../lib/errors';
import type { TokenService } from './token.service';

const REFRESH_REUSE_GRACE_MS = 30_000;
const SESSION_CACHE_TTL_SECONDS = 60;

export interface SessionContext {
  clientType: ClientType;
  ipAddress: string | null;
  userAgent: string | null;
  mfaVerified?: boolean;
}

export interface IssuedSession {
  session: Session;
  user: User;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface CachedSessionState {
  active: boolean;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
}

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly tokens: TokenService,
    private readonly env: Pick<ApiEnv, 'REFRESH_TOKEN_TTL_DAYS'>,
    private readonly clock: Clock,
  ) {}

  async create(user: User, context: SessionContext): Promise<IssuedSession> {
    const { token: refreshToken, hash } = this.tokens.generateRefreshToken();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
    const session = await this.db.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hash,
        clientType: context.clientType,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        mfaVerified: context.mfaVerified ?? false,
        expiresAt,
        lastUsedAt: now,
      },
    });
    const access = await this.tokens.signAccessToken({
      userId: user.id,
      sessionId: session.id,
      role: user.role,
    });
    return {
      session,
      user,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /**
   * Refresh token rotation with reuse detection: a token can be used exactly
   * once. Presenting an already rotated token (outside a short grace window for
   * parallel tabs) is treated as theft and revokes the whole session.
   */
  async rotate(
    refreshToken: string,
    context: Omit<SessionContext, 'clientType'>,
  ): Promise<IssuedSession> {
    const hash = sha256Hex(refreshToken);
    const now = this.clock.now();
    const session = await this.db.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });

    if (!session) {
      await this.detectReuse(hash, context, now);
      throw unauthorized('invalid_refresh_token', 'Session expired, please sign in again');
    }
    if (session.revokedAt || session.expiresAt <= now) {
      throw unauthorized('session_revoked', 'Session expired, please sign in again');
    }
    if (session.user.status !== 'ACTIVE' || session.user.deletedAt) {
      await this.revoke(session.id, 'account_inactive');
      throw unauthorized('account_inactive', 'Account is not active');
    }

    const next = this.tokens.generateRefreshToken();
    const updated = await this.db.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        refreshTokenHash: next.hash,
        previousRefreshTokenHash: hash,
        rotatedAt: now,
        lastUsedAt: now,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    if (updated.count === 0)
      throw unauthorized('refresh_race', 'Session refreshed concurrently, retry');

    const access = await this.tokens.signAccessToken({
      userId: session.userId,
      sessionId: session.id,
      role: session.user.role,
    });
    return {
      session: { ...session, refreshTokenHash: next.hash },
      user: session.user,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: next.token,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  private async detectReuse(
    hash: string,
    context: Omit<SessionContext, 'clientType'>,
    now: Date,
  ): Promise<void> {
    const rotated = await this.db.session.findFirst({ where: { previousRefreshTokenHash: hash } });
    if (!rotated || rotated.revokedAt) return;
    const withinGrace =
      rotated.rotatedAt && now.getTime() - rotated.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS;
    if (withinGrace) throw unauthorized('refresh_race', 'Session refreshed concurrently, retry');
    await this.revoke(rotated.id, 'refresh_token_reuse');
    await recordSecurityEvent(this.db, {
      userId: rotated.userId,
      type: 'REFRESH_TOKEN_REUSE',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { sessionId: rotated.id },
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
    await invalidateSessionCache(this.redis, [sessionId]);
  }

  async revokeByRefreshToken(refreshToken: string, reason: string): Promise<string | null> {
    const session = await this.db.session.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
    });
    if (!session) return null;
    await this.revoke(session.id, reason);
    return session.id;
  }

  /** Session validity + fresh role/status, cached briefly in Redis for all replicas. */
  async getState(sessionId: string): Promise<CachedSessionState | null> {
    const key = `${SESSION_CACHE_PREFIX}${sessionId}`;
    const cached = await this.redis.get(key);
    if (cached === '0') return null;
    if (cached) return JSON.parse(cached) as CachedSessionState;

    const session = await this.db.session.findUnique({
      where: { id: sessionId },
      select: {
        revokedAt: true,
        expiresAt: true,
        user: { select: { role: true, status: true, emailVerifiedAt: true, deletedAt: true } },
      },
    });
    const now = this.clock.now();
    if (!session || session.revokedAt || session.expiresAt <= now || session.user.deletedAt) {
      await this.redis.set(key, '0', 'EX', SESSION_CACHE_TTL_SECONDS);
      return null;
    }
    const state: CachedSessionState = {
      active: true,
      role: session.user.role,
      status: session.user.status,
      emailVerified: session.user.emailVerifiedAt !== null,
    };
    await this.redis.set(key, JSON.stringify(state), 'EX', SESSION_CACHE_TTL_SECONDS);
    return state;
  }

  /** Drops cached state (e.g. after role or verification changes) without revoking. */
  async refreshCache(userId: string): Promise<void> {
    const sessions = await this.db.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    if (sessions.length > 0)
      await this.redis.del(...sessions.map((s) => `${SESSION_CACHE_PREFIX}${s.id}`));
  }

  async touch(sessionId: string): Promise<void> {
    const key = `touch:${sessionId}`;
    // Update lastUsedAt at most once every 5 minutes per session.
    if (await this.redis.set(key, '1', 'EX', 300, 'NX')) {
      await this.db.session.updateMany({
        where: { id: sessionId },
        data: { lastUsedAt: this.clock.now() },
      });
    }
  }
}
