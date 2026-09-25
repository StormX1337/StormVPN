import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, loadEnv } from '../index';

const validApiEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadEnv', () => {
  it('parses a minimal valid API environment with defaults', () => {
    const env = loadEnv(apiEnvSchema, validApiEnv);
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.WG_DEFAULT_ALLOWED_IPS).toEqual(['0.0.0.0/0', '::/0']);
  });

  it('rejects placeholder secrets and wrong key sizes without echoing values', () => {
    try {
      loadEnv(apiEnvSchema, {
        ...validApiEnv,
        JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me',
        DATA_ENCRYPTION_KEY: 'c2hvcnQ=',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('DATA_ENCRYPTION_KEY');
      expect(message).not.toContain('change-me');
    }
  });

  it('enforces secure cookies in production', () => {
    expect(() =>
      loadEnv(apiEnvSchema, { ...validApiEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
  });
});
