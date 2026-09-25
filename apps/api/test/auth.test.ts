import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTotp } from '@stormvpn/crypto/node';
import { call, createHarness, type Harness, PASSWORD, registerUser, seedPlans } from './helpers/harness';

const native = { 'x-stormvpn-client': 'native' };
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ LOGIN_MAX_FAILURES: '3' });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await seedPlans(h);
});

function cookiesOf(response: { cookies: { name: string; value: string }[] }) {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

describe('browser auth flow (cookies + CSRF)', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'csrf@example.com', password: PASSWORD, acceptTerms: true },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('csrf_invalid');
  });

  it('registers with HttpOnly cookies and never exposes tokens in the body', async () => {
    const csrf = await h.app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
    const csrfToken = csrf.json().csrfToken as string;
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'x-csrf-token': csrfToken },
      cookies: { svpn_csrf: csrfToken },
      payload: { email: 'Browser@Example.com', password: PASSWORD, acceptTerms: true },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.tokens).toBeUndefined();
    expect(body.user.email).toBe('browser@example.com');
    expect(body.user.emailVerified).toBe(false);

    const accessCookie = response.cookies.find((cookie) => cookie.name === 'svpn_at')!;
    const refreshCookie = response.cookies.find((cookie) => cookie.name === 'svpn_rt')!;
    expect(accessCookie.httpOnly).toBe(true);
    expect(refreshCookie.httpOnly).toBe(true);
    expect(refreshCookie.path).toBe('/api/v1/auth');
    expect(refreshCookie.sameSite).toBe('Strict');

    const me = await h.app.inject({ method: 'GET', url: '/api/v1/user', cookies: { svpn_at: accessCookie.value } });
    expect(me.statusCode).toBe(200);

    // New accounts start on the free plan and receive a verification email.
    const subscription = await h.db.subscription.findFirstOrThrow({ where: { userId: body.user.id }, include: { plan: true } });
    expect(subscription.plan.slug).toBe('free');
    expect(h.mail.last('verify-email', 'browser@example.com')).toBeDefined();
  });

  it('refreshes via cookie and clears cookies on logout', async () => {
    const csrfToken = (await h.app.inject({ method: 'GET', url: '/api/v1/auth/csrf' })).json().csrfToken as string;
    const register = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'x-csrf-token': csrfToken },
      cookies: { svpn_csrf: csrfToken },
      payload: { email: 'cookie@example.com', password: PASSWORD, acceptTerms: true },
    });
    const cookies = cookiesOf(register);
    const refresh = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { 'x-csrf-token': csrfToken },
      cookies: { svpn_csrf: csrfToken, svpn_rt: cookies.svpn_rt! },
    });
    expect(refresh.statusCode, refresh.body).toBe(200);
    expect(cookiesOf(refresh).svpn_rt).not.toBe(cookies.svpn_rt);

    const logout = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { 'x-csrf-token': csrfToken },
      cookies: { svpn_csrf: csrfToken, svpn_rt: cookiesOf(refresh).svpn_rt! },
    });
    expect(logout.statusCode).toBe(204);
    expect(cookiesOf(logout).svpn_at).toBe('');
  });
});

describe('registration & login', () => {
  it('rejects duplicate emails and weak passwords', async () => {
    await registerUser(h, 'dup@example.com');
    const duplicate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: native,
      payload: { email: 'DUP@example.com', password: PASSWORD, acceptTerms: true },
    });
    expect(duplicate.statusCode).toBe(409);
    const weak = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: native,
      payload: { email: 'weak@example.com', password: 'short', acceptTerms: true },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('validation_error');
  });

  it('logs in with valid credentials and returns identical errors otherwise', async () => {
    await registerUser(h, 'login@example.com');
    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: native,
      payload: { email: 'login@example.com', password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tokens.accessToken).toBeTypeOf('string');

    const wrongPassword = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: native,
      payload: { email: 'login@example.com', password: 'wrong password!' },
    });
    const unknownUser = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: native,
      payload: { email: 'nobody@example.com', password: 'wrong password!' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message);
  });

  it('locks the account after repeated failures (brute-force protection)', async () => {
    await registerUser(h, 'brute@example.com');
    const attempt = (password: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: native,
        payload: { email: 'brute@example.com', password },
      });
    for (let i = 0; i < 3; i++) expect((await attempt('bad password!!')).statusCode).toBe(401);
    const locked = await attempt(PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('account_locked');
    const events = await h.db.securityEvent.findMany({ where: { type: { in: ['LOGIN_FAILED', 'LOGIN_LOCKED'] } } });
    expect(events.map((event) => event.type)).toContain('LOGIN_LOCKED');
  });

  it('blocks suspended accounts', async () => {
    const session = await registerUser(h, 'suspended@example.com');
    await h.db.user.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: native,
      payload: { email: 'suspended@example.com', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('refresh token rotation', () => {
  it('rotates tokens and revokes the session when an old token is replayed', async () => {
    const session = await registerUser(h, 'rotate@example.com');
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: native,
      payload: { refreshToken: session.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.json().tokens.refreshToken as string;
    expect(rotated).not.toBe(session.refreshToken);

    // Replay of the old token after the grace window = theft → session revoked.
    h.clock.advance(60_000);
    const replay = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: native,
      payload: { refreshToken: session.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    const afterReuse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: native,
      payload: { refreshToken: rotated },
    });
    expect(afterReuse.statusCode).toBe(401);
    expect(await h.db.securityEvent.count({ where: { type: 'REFRESH_TOKEN_REUSE' } })).toBe(1);

    // Revocation applies to access tokens immediately.
    const me = await call(h, { token: first.json().tokens.accessToken, userId: session.userId }, { method: 'GET', url: '/api/v1/user' });
    expect(me.statusCode).toBe(401);
  });
});

describe('email verification & password reset', () => {
  it('verifies email with a single-use token', async () => {
    const session = await registerUser(h, 'verify@example.com', { verify: false });
    const token = h.mail.tokenFrom('verify-email', 'verify@example.com');
    const verify = await h.app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', headers: native, payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().user.emailVerified).toBe(true);
    const again = await h.app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', headers: native, payload: { token } });
    expect(again.statusCode).toBe(400);
    const me = await call(h, session, { method: 'GET', url: '/api/v1/user' });
    expect(me.json().emailVerified).toBe(true);
  });

  it('resets the password and revokes all sessions without leaking account existence', async () => {
    const session = await registerUser(h, 'reset@example.com');
    const unknown = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      headers: native,
      payload: { email: 'missing@example.com' },
    });
    expect(unknown.statusCode).toBe(202);
    const known = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      headers: native,
      payload: { email: 'reset@example.com' },
    });
    expect(known.statusCode).toBe(202);

    const token = h.mail.tokenFrom('password-reset', 'reset@example.com');
    const reset = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      headers: native,
      payload: { token, password: 'a brand new passphrase' },
    });
    expect(reset.statusCode).toBe(204);
    expect((await call(h, session, { method: 'GET', url: '/api/v1/user' })).statusCode).toBe(401);
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: native,
      payload: { email: 'reset@example.com', password: 'a brand new passphrase' },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('enables TOTP, requires it at login, prevents replay and accepts backup codes once', async () => {
    const session = await registerUser(h, 'mfa@example.com');
    const setup = await call(h, session, { method: 'POST', url: '/api/v1/account/2fa/setup' });
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUrl } = setup.json();
    expect(otpauthUrl).toContain('otpauth://totp/StormVPN');

    const wrong = await call(h, session, { method: 'POST', url: '/api/v1/account/2fa/enable', payload: { code: '000000' } });
    expect(wrong.statusCode).toBe(400);
    const enable = await call(h, session, {
      method: 'POST',
      url: '/api/v1/account/2fa/enable',
      payload: { code: generateTotp(secret) },
    });
    expect(enable.statusCode).toBe(200);
    const backupCodes = enable.json().backupCodes as string[];
    expect(backupCodes).toHaveLength(10);

    const login = async () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: native,
        payload: { email: 'mfa@example.com', password: PASSWORD },
      });
    const challenge = (await login()).json();
    expect(challenge.mfaRequired).toBe(true);

    // The code used during enablement cannot be replayed within the same time step.
    const replay = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/mfa',
      headers: native,
      payload: { mfaToken: challenge.mfaToken, code: generateTotp(secret) },
    });
    expect(replay.statusCode).toBe(401);

    const withBackup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/mfa',
      headers: native,
      payload: { mfaToken: challenge.mfaToken, code: backupCodes[0] },
    });
    expect(withBackup.statusCode).toBe(200);
    expect(withBackup.json().tokens.accessToken).toBeTypeOf('string');

    const second = (await login()).json();
    const reuse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/mfa',
      headers: native,
      payload: { mfaToken: second.mfaToken, code: backupCodes[0] },
    });
    expect(reuse.statusCode).toBe(401);
    expect(await h.db.securityEvent.count({ where: { type: 'MFA_FAILED' } })).toBeGreaterThanOrEqual(2);
  });
});
