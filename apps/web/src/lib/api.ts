import { createApiClient } from '@stormvpn/api-client';

/** Browser API client (same-origin, cookie session + CSRF). */
export const api = createApiClient({
  onSessionExpired: () => {
    if (typeof window === 'undefined') return;
    document.cookie = 'svpn_session=; Max-Age=0; path=/';
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    if (!window.location.pathname.startsWith('/login'))
      window.location.assign(`/login?next=${next}`);
  },
});

/** Only allow same-site relative redirect targets (prevents open redirects). */
export function safeNext(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return fallback;
  return value;
}
