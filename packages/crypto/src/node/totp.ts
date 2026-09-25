import { createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  period?: number;
  digits?: number;
  /** Accepted clock drift in time steps (each direction). */
  window?: number;
  timestamp?: number;
}

/** Generates a 160 bit TOTP secret (base32). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

export function currentTotpStep(options: TotpOptions = {}): number {
  const period = options.period ?? 30;
  return Math.floor((options.timestamp ?? Date.now()) / 1000 / period);
}

/** RFC 6238 TOTP code for the given secret. */
export function generateTotp(secret: string, options: TotpOptions = {}): string {
  return hotp(base32Decode(secret), currentTotpStep(options), options.digits ?? 6);
}

/**
 * Verifies a TOTP code. Returns the matched time step (to prevent replay by
 * persisting the last used step) or null when invalid.
 */
export function verifyTotp(secret: string, code: string, options: TotpOptions = {}): number | null {
  const digits = options.digits ?? 6;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null;
  const key = base32Decode(secret);
  const step = currentTotpStep(options);
  const window = options.window ?? 1;
  for (let drift = -window; drift <= window; drift++) {
    if (hotp(key, step + drift, digits) === code) return step + drift;
  }
  return null;
}

export function buildOtpAuthUrl(params: { secret: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
