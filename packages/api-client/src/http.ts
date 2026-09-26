import { ApiError } from './errors';

const CSRF_COOKIE = 'svpn_csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REFRESHABLE = new Set(['unauthorized', 'token_expired', 'invalid_token']);

export interface TokenStore {
  /** Native clients: persist tokens in the OS keychain. */
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: { accessToken: string; refreshToken: string }): void;
  clear(): void;
}

export interface HttpOptions {
  /** API origin; empty string = same origin (browser apps behind the reverse proxy). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called when the session cannot be refreshed any more. */
  onSessionExpired?: () => void;
  /** When set, the client behaves as a native app (bearer tokens instead of cookies). */
  tokenStore?: TokenStore;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Skip the automatic refresh-and-retry on 401. */
  noRefresh?: boolean;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Fetch wrapper implementing StormVPN's browser security model:
 * HttpOnly session cookies, double-submit CSRF header, and transparent
 * access token refresh (single-flight) on expiry.
 */
export class HttpClient {
  private refreshing: Promise<boolean> | null = null;
  private csrfPromise: Promise<string> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get baseUrl(): string {
    return this.options.baseUrl ?? '';
  }

  get isNative(): boolean {
    return this.options.tokenStore !== undefined;
  }

  private async csrfToken(): Promise<string> {
    const existing = readCookie(CSRF_COOKIE);
    if (existing) return existing;
    this.csrfPromise ??= this.fetchImpl(`${this.baseUrl}/api/v1/auth/csrf`, {
      credentials: 'include',
    })
      .then(async (response) => ((await response.json()) as { csrfToken: string }).csrfToken)
      .finally(() => {
        this.csrfPromise = null;
      });
    return this.csrfPromise;
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const url = `${this.baseUrl}/api/v1${path}`;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `${url}?${text}` : url;
  }

  private async headers(method: string, hasBody: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (hasBody) headers['content-type'] = 'application/json';
    const store = this.options.tokenStore;
    if (store) {
      headers['x-stormvpn-client'] = 'native';
      const token = store.getAccessToken();
      if (token) headers.authorization = `Bearer ${token}`;
    } else if (UNSAFE.has(method)) {
      headers['x-csrf-token'] = await this.csrfToken();
    }
    return headers;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const hasBody = options.body !== undefined;
    const response = await this.fetchImpl(this.url(path, options.query), {
      method,
      credentials: 'include',
      headers: await this.headers(method, hasBody),
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 204) return undefined as T;
    if (response.ok) return (await response.json()) as T;

    const error = await ApiError.fromResponse(response);
    if (
      response.status === 401 &&
      !options.noRefresh &&
      REFRESHABLE.has(error.code) &&
      (await this.refresh())
    ) {
      return this.request<T>(method, path, { ...options, noRefresh: true });
    }
    if (response.status === 401 && !options.noRefresh) this.options.onSessionExpired?.();
    throw error;
  }

  /** Rotates the refresh token once for all concurrent callers. */
  async refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const store = this.options.tokenStore;
        const refreshToken = store?.getRefreshToken();
        if (store && !refreshToken) return false;
        const response = await this.fetchImpl(this.url('/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: { ...(await this.headers('POST', true)) },
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        });
        if (!response.ok) {
          store?.clear();
          return false;
        }
        const body = (await response.json()) as {
          tokens?: { accessToken: string; refreshToken: string };
        };
        if (store && body.tokens) store.setTokens(body.tokens);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          this.refreshing = null;
        }, 0);
      }
    })();
    return this.refreshing;
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body: body ?? {} });
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body: body ?? {} });
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }
  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body === undefined ? {} : { body });
  }
}
