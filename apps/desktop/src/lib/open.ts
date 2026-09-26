import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

/** Opens a link in the system browser (the webview never navigates away). */
export function openExternal(url: string): void {
  if (isTauri()) void openUrl(url);
  else window.open(url, '_blank', 'noopener');
}
