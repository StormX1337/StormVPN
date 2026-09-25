import {
  buildOtpAuthUrl,
  type DataEncryptor,
  generateBackupCodes,
  generateTotpSecret,
  normalizeBackupCode,
  sha256Hex,
  verifyTotp,
} from '@stormvpn/crypto/node';
import { recordSecurityEvent } from '@stormvpn/core';
import type { Database, User } from '@stormvpn/database';
import type { Redis } from 'ioredis';
import type { Clock } from '../../lib/clock';
import { badRequest, conflict } from '../../lib/errors';

const PENDING_SECRET_TTL_SECONDS = 600;
const ISSUER = 'StormVPN';

/** TOTP (RFC 6238) two-factor authentication with one-time backup codes. */
export class MfaService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly encryptor: DataEncryptor,
    private readonly clock: Clock,
  ) {}

  private pendingKey(userId: string): string {
    return `mfa:setup:${userId}`;
  }

  async beginSetup(user: User): Promise<{ secret: string; otpauthUrl: string }> {
    if (user.totpEnabledAt) throw conflict('mfa_already_enabled', 'Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.redis.set(this.pendingKey(user.id), this.encryptor.encrypt(secret, user.id), 'EX', PENDING_SECRET_TTL_SECONDS);
    return { secret, otpauthUrl: buildOtpAuthUrl({ secret, accountName: user.email, issuer: ISSUER }) };
  }

  async enable(user: User, code: string): Promise<string[]> {
    const pending = await this.redis.get(this.pendingKey(user.id));
    if (!pending) throw badRequest('mfa_setup_expired', 'Setup expired, start again');
    const secret = this.encryptor.decrypt(pending, user.id);
    const step = verifyTotp(secret, code, { timestamp: this.clock.now().getTime() });
    if (step === null) throw badRequest('invalid_mfa_code', 'Invalid verification code');

    const backupCodes = generateBackupCodes(10);
    await this.db.$transaction([
      this.db.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: this.encryptor.encrypt(secret, user.id),
          totpEnabledAt: this.clock.now(),
          totpLastUsedStep: step,
        },
      }),
      this.db.backupCode.deleteMany({ where: { userId: user.id } }),
      this.db.backupCode.createMany({
        data: backupCodes.map((backupCode) => ({ userId: user.id, codeHash: sha256Hex(normalizeBackupCode(backupCode)) })),
      }),
    ]);
    await this.redis.del(this.pendingKey(user.id));
    await recordSecurityEvent(this.db, { userId: user.id, type: 'MFA_ENABLED' });
    return backupCodes;
  }

  /**
   * Verifies a TOTP code (with replay protection via the last used time step)
   * or consumes a backup code.
   */
  async verify(user: User, code: string): Promise<boolean> {
    if (!user.totpSecretEnc) return false;
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const secret = this.encryptor.decrypt(user.totpSecretEnc, user.id);
      const step = verifyTotp(secret, trimmed, { timestamp: this.clock.now().getTime() });
      if (step === null) return false;
      const updated = await this.db.user.updateMany({
        where: {
          id: user.id,
          OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
        },
        data: { totpLastUsedStep: step },
      });
      return updated.count === 1;
    }
    const codeHash = sha256Hex(normalizeBackupCode(trimmed));
    const consumed = await this.db.backupCode.updateMany({
      where: { userId: user.id, codeHash, usedAt: null },
      data: { usedAt: this.clock.now() },
    });
    return consumed.count === 1;
  }

  async disable(user: User): Promise<void> {
    await this.db.$transaction([
      this.db.user.update({
        where: { id: user.id },
        data: { totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null },
      }),
      this.db.backupCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await recordSecurityEvent(this.db, { userId: user.id, type: 'MFA_DISABLED', severity: 'MEDIUM' });
  }

  async regenerateBackupCodes(user: User): Promise<string[]> {
    const backupCodes = generateBackupCodes(10);
    await this.db.$transaction([
      this.db.backupCode.deleteMany({ where: { userId: user.id } }),
      this.db.backupCode.createMany({
        data: backupCodes.map((backupCode) => ({ userId: user.id, codeHash: sha256Hex(normalizeBackupCode(backupCode)) })),
      }),
    ]);
    return backupCodes;
  }
}
