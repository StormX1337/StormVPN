import { invoke, isTauri } from '@tauri-apps/api/core';

export type TunnelState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/** Bridge to the Rust side (tunnel service, Credential Manager). Browser dev mode uses stubs. */
export const native = {
  available: isTauri(),
  connect: (config: string) => invoke<void>('tunnel_connect', { config }),
  disconnect: () => (isTauri() ? invoke<void>('tunnel_disconnect') : Promise.resolve()),
  state: () =>
    isTauri() ? invoke<TunnelState>('tunnel_state') : Promise.resolve<TunnelState>('disconnected'),
  deviceName: () => (isTauri() ? invoke<string>('device_name') : Promise.resolve('Browser')),
  secretGet: (key: string) =>
    isTauri()
      ? invoke<string | null>('secret_get', { key })
      : Promise.resolve(sessionStorage.getItem(key)),
  secretSet: (key: string, value: string) =>
    isTauri()
      ? invoke<void>('secret_set', { key, value })
      : Promise.resolve(sessionStorage.setItem(key, value)),
  secretDelete: (key: string) =>
    isTauri()
      ? invoke<void>('secret_delete', { key })
      : Promise.resolve(sessionStorage.removeItem(key)),
};
