const API_URL_KEY = 'stormvpn.apiUrl';
const DEVICE_KEY = 'stormvpn.deviceId';
const CONNECTION_KEY = 'stormvpn.connectionId';
const SERVER_KEY = 'stormvpn.serverId';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable – settings stay in memory for this session.
  }
}

/** Normalises user input like "vpn.example.com" to "https://vpn.example.com". */
export function normalizeApiUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme).origin;
}

export const settings = {
  apiUrl: () => read(API_URL_KEY) ?? (import.meta.env.VITE_STORMVPN_API_URL || null),
  setApiUrl: (url: string) => write(API_URL_KEY, url),
  deviceId: () => read(DEVICE_KEY),
  setDeviceId: (id: string | null) => write(DEVICE_KEY, id),
  connectionId: () => read(CONNECTION_KEY),
  setConnectionId: (id: string | null) => write(CONNECTION_KEY, id),
  serverId: () => read(SERVER_KEY),
  setServerId: (id: string | null) => write(SERVER_KEY, id),
};
