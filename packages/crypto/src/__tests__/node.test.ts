import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUrl,
  DataEncryptor,
  generateBackupCodes,
  generateTotp,
  generateTotpSecret,
  hashPassword,
  normalizeBackupCode,
  passwordNeedsRehash,
  safeEqual,
  sha256Hex,
  verifyPassword,
  verifyTotp,
} from '../node';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
    expect(passwordNeedsRehash('$argon2id$v=19$m=4096,t=1,p=1$abc$def')).toBe(true);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('DataEncryptor', () => {
  it('round-trips and authenticates associated data', () => {
    const encryptor = new DataEncryptor(key(1));
    const payload = encryptor.encrypt('secret-psk', 'peer:1');
    expect(payload).not.toContain('secret-psk');
    expect(encryptor.decrypt(payload, 'peer:1')).toBe('secret-psk');
    expect(() => encryptor.decrypt(payload, 'peer:2')).toThrow();
  });

  it('supports key rotation', () => {
    const old = new DataEncryptor(key(1));
    const payload = old.encrypt('value');
    const rotated = new DataEncryptor(key(2), [key(1)]);
    expect(rotated.decrypt(payload)).toBe('value');
    expect(rotated.needsReencryption(payload)).toBe(true);
    expect(rotated.needsReencryption(rotated.encrypt('value'))).toBe(false);
    expect(() => new DataEncryptor(key(3)).decrypt(payload)).toThrow(/Unknown encryption key/);
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B test secret "12345678901234567890" (SHA1), 8 digits.
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches RFC vector at T=%i', (seconds, expected) => {
    expect(generateTotp(rfcSecret, { timestamp: seconds * 1000, digits: 8 })).toBe(expected);
  });

  it('verifies within the drift window and returns the matched step', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const previous = generateTotp(secret, { timestamp: now - 30_000 });
    expect(verifyTotp(secret, previous, { timestamp: now })).toBe(Math.floor(now / 30_000) - 1);
    const old = generateTotp(secret, { timestamp: now - 120_000 });
    expect(verifyTotp(secret, old, { timestamp: now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { timestamp: now })).toBeNull();
  });

  it('base32 round-trips and builds otpauth URLs', () => {
    const buffer = Buffer.from('hello world');
    expect(base32Decode(base32Encode(buffer)).toString()).toBe('hello world');
    const url = buildOtpAuthUrl({ secret: 'ABC', accountName: 'a@b.c', issuer: 'StormVPN' });
    expect(url).toMatch(/^otpauth:\/\/totp\/StormVPN%3Aa%40b\.c\?secret=ABC&issuer=StormVPN/);
  });
});

describe('tokens', () => {
  it('generates unique backup codes and normalises input', () => {
    const codes = generateBackupCodes(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeBackupCode(' ab12-cd34 ')).toBe('AB12CD34');
  });

  it('hashes and compares in constant time', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
