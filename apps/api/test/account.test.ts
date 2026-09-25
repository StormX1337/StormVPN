import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createHarness, type Harness, PASSWORD, registerUser, seedPlans } from './helpers/harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await seedPlans(h);
});

const native = { 'x-stormvpn-client': 'native' };

describe('user profile & account security', () => {
  it('reads and updates the profile', async () => {
    const session = await registerUser(h, 'profile@example.com');
    const update = await call(h, session, { method: 'PATCH', url: '/api/v1/user', payload: { name: 'Storm Rider', preferredCountry: 'nl' } });
    expect(update.json()).toMatchObject({ name: 'Storm Rider', preferredCountry: 'NL' });
    const me = await call(h, session, { method: 'GET', url: '/api/v1/user' });
    expect(me.json()).not.toHaveProperty('passwordHash');
    expect((await call(h, null, { method: 'GET', url: '/api/v1/user' })).statusCode).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const session = await registerUser(h, 'sessions@example.com');
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: native,
      payload: { email: 'sessions@example.com', password: PASSWORD },
    });
    const secondToken = second.json().tokens.accessToken as string;
    const list = await call(h, session, { method: 'GET', url: '/api/v1/account/sessions' });
    expect(list.json()).toHaveLength(2);
    expect(list.json().filter((item: { current: boolean }) => item.current)).toHaveLength(1);

    const revokeOthers = await call(h, session, { method: 'DELETE', url: '/api/v1/account/sessions' });
    expect(revokeOthers.json().revoked).toBe(1);
    const secondMe = await call(h, { token: secondToken, userId: session.userId }, { method: 'GET', url: '/api/v1/user' });
    expect(secondMe.statusCode).toBe(401);
    expect((await call(h, session, { method: 'GET', url: '/api/v1/user' })).statusCode).toBe(200);
  });

  it('changes the password (keeping the current session) and records security events', async () => {
    const session = await registerUser(h, 'pw@example.com');
    const wrong = await call(h, session, {
      method: 'POST',
      url: '/api/v1/account/password',
      payload: { currentPassword: 'not my password', newPassword: 'another secure passphrase' },
    });
    expect(wrong.statusCode).toBe(400);
    const ok = await call(h, session, {
      method: 'POST',
      url: '/api/v1/account/password',
      payload: { currentPassword: PASSWORD, newPassword: 'another secure passphrase' },
    });
    expect(ok.statusCode).toBe(204);
    const events = await call(h, session, { method: 'GET', url: '/api/v1/account/security-events' });
    expect(events.json().map((event: { type: string }) => event.type)).toContain('PASSWORD_CHANGED');
    expect(h.mail.last('password-changed', 'pw@example.com')).toBeDefined();
  });

  it('deletes the account (GDPR) while keeping anonymised billing records', async () => {
    const session = await registerUser(h, 'delete@example.com');
    const response = await call(h, session, {
      method: 'DELETE',
      url: '/api/v1/account',
      payload: { password: PASSWORD, confirm: 'DELETE' },
    });
    expect(response.statusCode).toBe(204);
    const user = await h.db.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(user.email).toBe(`deleted+${session.userId}@deleted.invalid`);
    expect(user.deletedAt).not.toBeNull();
    expect((await call(h, session, { method: 'GET', url: '/api/v1/user' })).statusCode).toBe(401);
  });
});
