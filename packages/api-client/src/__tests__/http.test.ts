import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from '../index';

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HttpClient', () => {
  it('fetches a CSRF token before unsafe browser requests', async () => {
    const { fetchImpl, calls } = mockFetch((url) =>
      url.endsWith('/auth/csrf') ? json(200, { csrfToken: 'csrf-123' }) : json(200, { id: 'd1' }),
    );
    const api = createApiClient({ fetch: fetchImpl });
    await api.devices.create({ name: 'Laptop', platform: 'LINUX' });
    expect(calls[0]!.url).toBe('/api/v1/auth/csrf');
    expect((calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-123');
    expect(calls[1]!.init.credentials).toBe('include');
  });

  it('refreshes once on expiry and retries the request', async () => {
    let refreshed = false;
    const { fetchImpl, calls } = mockFetch((url) => {
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: 't' });
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return json(200, { user: {} });
      }
      return refreshed
        ? json(200, { id: 'u1' })
        : json(401, { error: { code: 'unauthorized', message: 'no' } });
    });
    const api = createApiClient({ fetch: fetchImpl });
    const [a, b] = await Promise.all([api.user.me(), api.user.me()]);
    expect(a).toEqual({ id: 'u1' });
    expect(b).toEqual({ id: 'u1' });
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('surfaces API errors with codes and notifies on session expiry', async () => {
    let expired = 0;
    const { fetchImpl } = mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'invalid_refresh_token', message: 'x' } })
        : json(401, { error: { code: 'unauthorized', message: 'Auth' } }),
    );
    const api = createApiClient({ fetch: fetchImpl, onSessionExpired: () => expired++ });
    await expect(api.user.me()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(expired).toBe(1);
  });

  it('uses bearer tokens and the native header when a token store is provided', async () => {
    const { fetchImpl, calls } = mockFetch(() => json(200, []));
    const api = createApiClient({
      fetch: fetchImpl,
      baseUrl: 'https://api.stormvpn.test',
      tokenStore: {
        getAccessToken: () => 'at',
        getRefreshToken: () => 'rt',
        setTokens: () => undefined,
        clear: () => undefined,
      },
    });
    await api.servers.list({ country: 'DE' });
    expect(calls[0]!.url).toBe('https://api.stormvpn.test/api/v1/servers?country=DE');
    expect(calls[0]!.init.headers).toMatchObject({
      authorization: 'Bearer at',
      'x-stormvpn-client': 'native',
    });
  });

  it('exposes field errors', () => {
    const error = new ApiError(400, 'validation_error', 'bad', {
      issues: [{ path: 'email', message: 'Invalid' }],
    });
    expect(error.fieldErrors).toEqual({ email: 'Invalid' });
  });
});
