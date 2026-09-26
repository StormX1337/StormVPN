import { createApiClient, isApiError, type TokenStore } from '@stormvpn/api-client';
import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { native } from './native';

const REFRESH_KEY = 'refresh-token';

let accessToken: string | null = null;
let refreshToken: string | null = null;

/** Access token in memory, refresh token in the Windows Credential Manager. */
const tokenStore: TokenStore = {
  getAccessToken: () => accessToken,
  getRefreshToken: () => refreshToken,
  setTokens(tokens) {
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
    void native.secretSet(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    accessToken = null;
    refreshToken = null;
    void native.secretDelete(REFRESH_KEY);
  },
};

export type Api = ReturnType<typeof createApiClient>;

export function createClient(baseUrl: string, onSessionExpired: () => void): Api {
  return createApiClient({
    baseUrl,
    tokenStore,
    onSessionExpired,
    // Rust side HTTP client: no CORS restrictions for the webview origin.
    fetch: isTauri() ? (tauriFetch as typeof fetch) : undefined,
  });
}

export async function restoreSession(): Promise<boolean> {
  refreshToken = await native.secretGet(REFRESH_KEY).catch(() => null);
  return refreshToken !== null;
}

export function storeTokens(tokens: { accessToken: string; refreshToken: string }): void {
  tokenStore.setTokens(tokens);
}

export function clearSession(): void {
  tokenStore.clear();
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (isApiError(error)) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
