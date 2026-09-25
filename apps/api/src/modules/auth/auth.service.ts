import type { Redis } from 'ioredis';
import {
  generateToken,
  getDummyPasswordHash,
  hashPassword,
  passwordNeedsRehash,
  sha256Hex,
  verifyPassword,
} from '@stormvpn/crypto/node';
import {
  ensureFreeSubscription,
  type MailQueue,
  recordSecurityEvent,
  revokeUserSessions,
  type SettingsService,
  writeAuditLog,
} from '@stormvpn/core';
import { type ClientType, type Database, isUniqueViolation, type TokenPurpose, type User } from '@stormvpn/database';
import type { LoginInput, RegisterInput } from '@stormvpn/validation';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import type { RedisCounter } from '../../lib/counter';
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from '../../lib/errors';
import type { MfaService } from '../account/mfa.service';
import type { BruteForceGuard } from './brute-force';
import type { IssuedSession, SessionService } from './session.service';

const MFA_CHALLENGE_TTL_SECONDS = 300;
const MFA_MAX_ATTEMPTS = 5;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;

export interface RequestMeta {
  ipAddress: string;
  userAgent: string | null;
  clientType: ClientType;
}

export type LoginOutcome = { kind: 'session'; issued: IssuedSession } | { kind: 'mfa'; mfaToken: string };

interface MfaChallenge {
  userId: string;
  clientType: ClientType;
  attempts: number;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly env: ApiEnv,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly bruteForce: BruteForceGuard,
    private readonly counter: RedisCounter,
    private readonly mail: MailQueue,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    const settings = await this.settings.get();
    if (!this.env.REGISTRATION_ENABLED || !settings.registrationEnabled) {
      throw forbidden('registration_disabled', 'Registration is currently disabled');
    }
    await this.assertIpNotFlagged(meta.ipAddress);
    const day = this.clock.now().toISOString().slice(0, 10);
    const quota = await this.counter.hit(`reg:ip:${meta.ipAddress}:${day}`, this.env.REGISTRATIONS_PER_IP_PER_DAY, 86_400);
    if (quota.exceeded) {
      await recordSecurityEvent(this.db, { type: 'RATE_LIMITED', ipAddress: meta.ipAddress, metadata: { scope: 'registration' } });
      throw tooManyRequests('registration_limit', 'Too many accounts created from this network today');
    }

    const passwordHash = await hashPassword(input.password);
    let user: User;
    try {
      user = await this.db.user.create({ data: { email: input.email, passwordHash, name: input.name ?? null } });
    } catch (error) {
      if (isUniqueViolation(error, 'email')) throw conflict('email_taken', 'An account with this email already exists');
      throw error;
    }

    await ensureFreeSubscription(this.db, user.id);
    await this.sendVerificationEmail(user);
    await writeAuditLog(this.db, {
      actorId: user.id,
      actorType: 'USER',
      action: 'user.register',
      targetType: 'user',
      targetId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return this.sessions.create(user, meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginOutcome> {
    await this.bruteForce.assertAllowed(input.email, meta.ipAddress);
    const user = await this.db.user.findUnique({ where: { email: input.email } });

    const valid = user && !user.deletedAt
      ? await verifyPassword(user.passwordHash, input.password)
      : (await verifyPassword(await getDummyPasswordHash(), input.password), false);

    if (!user || !valid) {
      const locked = await this.bruteForce.recordFailure(input.email, meta.ipAddress);
      await recordSecurityEvent(this.db, {
        userId: user?.id ?? null,
        type: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw unauthorized('invalid_credentials', 'Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      throw forbidden('account_suspended', 'This account has been suspended. Contact support.');
    }
    await this.bruteForce.reset(input.email);

    if (passwordNeedsRehash(user.passwordHash)) {
      await this.db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
    }

    if (user.totpEnabledAt) {
      const mfaToken = generateToken(32);
      const challenge: MfaChallenge = { userId: user.id, clientType: meta.clientType, attempts: 0 };
      await this.redis.set(`mfa:challenge:${sha256Hex(mfaToken)}`, JSON.stringify(challenge), 'EX', MFA_CHALLENGE_TTL_SECONDS);
      return { kind: 'mfa', mfaToken };
    }
    return { kind: 'session', issued: await this.completeLogin(user, meta, false) };
  }

  async completeMfaLogin(mfaToken: string, code: string, meta: RequestMeta): Promise<IssuedSession> {
    const key = `mfa:challenge:${sha256Hex(mfaToken)}`;
    const raw = await this.redis.get(key);
    if (!raw) throw unauthorized('mfa_expired', 'Sign-in expired, please start again');
    const challenge = JSON.parse(raw) as MfaChallenge;
    const user = await this.db.user.findUnique({ where: { id: challenge.userId } });
    if (!user || user.status !== 'ACTIVE') {
      await this.redis.del(key);
      throw unauthorized('mfa_expired', 'Sign-in expired, please start again');
    }

    if (!(await this.mfa.verify(user, code))) {
      challenge.attempts += 1;
      await recordSecurityEvent(this.db, {
        userId: user.id,
        type: 'MFA_FAILED',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
        await this.redis.del(key);
        throw tooManyRequests('mfa_locked', 'Too many invalid codes, please sign in again');
      }
      await this.redis.set(key, JSON.stringify(challenge), 'KEEPTTL');
      throw unauthorized('invalid_mfa_code', 'Invalid verification code');
    }
    await this.redis.del(key);
    return this.completeLogin(user, { ...meta, clientType: challenge.clientType }, true);
  }

  private async completeLogin(user: User, meta: RequestMeta, mfaVerified: boolean): Promise<IssuedSession> {
    const newLocation = user.lastLoginIp !== null && user.lastLoginIp !== meta.ipAddress;
    await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: this.clock.now(), lastLoginIp: meta.ipAddress },
    });
    await recordSecurityEvent(this.db, {
      userId: user.id,
      type: 'LOGIN_SUCCESS',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { mfa: mfaVerified, clientType: meta.clientType },
    });
    if (newLocation) {
      await this.mail.send({
        template: 'new-login',
        to: user.email,
        data: { ipAddress: meta.ipAddress, userAgent: meta.userAgent ?? 'unknown', time: this.clock.now().toISOString() },
      });
    }
    return this.sessions.create(user, { ...meta, mfaVerified });
  }

  async sendVerificationEmail(user: User): Promise<void> {
    const token = await this.createToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TTL_MS);
    await this.mail.send({
      template: 'verify-email',
      to: user.email,
      data: { name: user.name ?? '', link: `${this.env.APP_URL}/verify-email?token=${encodeURIComponent(token)}` },
    });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw conflict('already_verified', 'Email address is already verified');
    const quota = await this.counter.hit(`verify:resend:${userId}`, 3, 3600);
    if (quota.exceeded) throw tooManyRequests('resend_limit', 'Please wait before requesting another email');
    await this.sendVerificationEmail(user);
  }

  async verifyEmail(token: string): Promise<User> {
    const record = await this.consumeToken(token, 'EMAIL_VERIFICATION');
    const user = await this.db.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: this.clock.now() },
    });
    await this.sessions.refreshCache(user.id);
    await recordSecurityEvent(this.db, { userId: user.id, type: 'EMAIL_VERIFIED' });
    await this.mail.send({ template: 'welcome', to: user.email, data: { name: user.name ?? '' } });
    return user;
  }

  /** Always succeeds from the caller's perspective to prevent account enumeration. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const quota = await this.counter.hit(`pwreset:${sha256Hex(email)}`, 3, 3600);
    const ipQuota = await this.counter.hit(`pwreset:ip:${meta.ipAddress}`, 20, 3600);
    if (quota.exceeded || ipQuota.exceeded) return;
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return;
    const token = await this.createToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
    await recordSecurityEvent(this.db, {
      userId: user.id,
      type: 'PASSWORD_RESET_REQUESTED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.mail.send({
      template: 'password-reset',
      to: user.email,
      data: { link: `${this.env.APP_URL}/reset-password?token=${encodeURIComponent(token)}` },
    });
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const record = await this.consumeToken(token, 'PASSWORD_RESET');
    const user = await this.db.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await this.db.verificationToken.updateMany({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: this.clock.now() },
    });
    await revokeUserSessions(this.db, this.redis, user.id, 'password_reset');
    await recordSecurityEvent(this.db, {
      userId: user.id,
      type: 'PASSWORD_RESET',
      severity: 'MEDIUM',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await this.mail.send({ template: 'password-changed', to: user.email, data: { time: this.clock.now().toISOString() } });
  }

  private async createToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
    const token = generateToken(32);
    await this.db.verificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(this.clock.now().getTime() + ttlMs),
      },
    });
    return token;
  }

  private async consumeToken(token: string, purpose: TokenPurpose) {
    const now = this.clock.now();
    const record = await this.db.verificationToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt <= now) {
      throw badRequest('invalid_token', 'This link is invalid or has expired');
    }
    const claimed = await this.db.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) throw badRequest('invalid_token', 'This link is invalid or has expired');
    return record;
  }

  private async assertIpNotFlagged(ip: string): Promise<void> {
    const flag = await this.db.riskFlag.findFirst({
      where: {
        subjectType: 'IP',
        subjectValue: ip,
        resolvedAt: null,
        score: { gte: 50 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: this.clock.now() } }],
      },
    });
    if (flag) throw forbidden('registration_blocked', 'Registration is not possible from this network');
  }
}
