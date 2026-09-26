/** Cookie names shared between API and web frontends. */
export const COOKIE_ACCESS_TOKEN = 'svpn_at';
export const COOKIE_REFRESH_TOKEN = 'svpn_rt';
export const COOKIE_CSRF_TOKEN = 'svpn_csrf';
/** Non-sensitive flag (no token) readable by page routes to decide on login redirects. */
export const COOKIE_SESSION_HINT = 'svpn_session';
export const HEADER_CSRF_TOKEN = 'x-csrf-token';
/** Native clients set this header to receive tokens in the response body instead of cookies. */
export const HEADER_CLIENT_TYPE = 'x-stormvpn-client';

export const API_PREFIX = '/api/v1';

/** Queue names used by API (producer), scheduler and worker (consumers). */
export const QUEUE_EMAIL = 'email';
export const QUEUE_MAINTENANCE = 'maintenance';

/** Redis pub/sub channels for realtime fan-out across API replicas. */
export const CHANNEL_USER_EVENTS = 'stormvpn:events:user';
export const CHANNEL_ADMIN_EVENTS = 'stormvpn:events:admin';
