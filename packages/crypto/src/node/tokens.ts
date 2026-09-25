import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Cryptographically secure URL-safe random token. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Prefixed opaque token, e.g. `snt_<random>` for node tokens. */
export function generatePrefixedToken(prefix: string, bytes = 32): string {
  return `${prefix}_${generateToken(bytes)}`;
}

/** SHA-256 hex digest – used to store high entropy tokens (never passwords). */
export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string | Buffer, value: string | Buffer): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Human friendly one-time backup codes (e.g. `7GQK-2M9D`). */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export function normalizeBackupCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
