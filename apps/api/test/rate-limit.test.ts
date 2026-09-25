import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createHarness, type Harness, registerUser, seedPlans } from './helpers/harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ AUTH_RATE_LIMIT_PER_MINUTE: '3', RATE_LIMIT_MAX_PER_MINUTE: '20', REGISTRATIONS_PER_IP_PER_DAY: '2' });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await seedPlans(h);
});

const native = { 'x-stormvpn-client': 'native' };

describe('rate limits', () => {
  it('limits authentication endpoints per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        headers: native,
        payload: { email: `user${i}@example.com` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 3)).toEqual([202, 202, 202]);
    expect(statuses[3]).toBe(429);
    const limited = await h.app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', headers: native, payload: { email: 'x@example.com' } });
    expect(limited.json().error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(await h.db.securityEvent.count({ where: { type: 'RATE_LIMITED' } })).toBeGreaterThan(0);
  });

  it('applies the global API limit', async () => {
    const session = await registerUser(h, 'global@example.com');
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const response = await call(h, session, { method: 'GET', url: '/api/v1/user' });
      if (response.statusCode === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('caps account registrations per IP and day', async () => {
    const register = (email: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { ...native, 'x-forwarded-for': '198.51.100.1' },
        remoteAddress: '198.51.100.1',
        payload: { email, password: 'correct horse battery staple', acceptTerms: true },
      });
    expect((await register('a@example.com')).statusCode).toBe(201);
    expect((await register('b@example.com')).statusCode).toBe(201);
    const third = await register('c@example.com');
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('registration_limit');
  });
});
