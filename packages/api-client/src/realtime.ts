import type { RealtimeClientMessage, RealtimeMessage } from '@stormvpn/types';

export interface RealtimeOptions {
  /** Absolute ws(s):// URL; defaults to the current origin + /api/v1/ws. */
  url?: string;
  onMessage: (message: RealtimeMessage) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed') => void;
  WebSocketImpl?: typeof WebSocket;
}

/** Auto-reconnecting WebSocket with exponential backoff and keep-alive pings. */
export function connectRealtime(options: RealtimeOptions): { close(): void; send(message: RealtimeClientMessage): void } {
  const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
  const url =
    options.url ??
    `${globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location.host}/api/v1/ws`;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed) return;
    options.onStatus?.('connecting');
    socket = new Impl(url);
    socket.onopen = () => {
      attempt = 0;
      options.onStatus?.('open');
      ping = setInterval(() => socket?.readyState === 1 && socket.send(JSON.stringify({ type: 'ping' })), 25_000);
    };
    socket.onmessage = (event) => {
      try {
        options.onMessage(JSON.parse(String(event.data)) as RealtimeMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      clearInterval(ping);
      options.onStatus?.('closed');
      if (closed) return;
      attempt += 1;
      retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };
    socket.onerror = () => socket?.close();
  };
  open();

  return {
    close() {
      closed = true;
      clearInterval(ping);
      clearTimeout(retry);
      socket?.close();
    },
    send(message) {
      if (socket?.readyState === 1) socket.send(JSON.stringify(message));
    },
  };
}
