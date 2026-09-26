import { createApiClient } from '@stormvpn/api-client';

export const api = createApiClient({
  onSessionExpired: () => {
    if (typeof window === 'undefined') return;
    if (!window.location.pathname.startsWith('/admin/login'))
      window.location.assign('/admin/login');
  },
});
