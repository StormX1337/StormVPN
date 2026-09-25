export interface WireGuardClientConfigInput {
  /** Client private key. Omit to render a template with PRIVATE_KEY_PLACEHOLDER. */
  privateKey?: string;
  addresses: string[];
  dns: string[];
  serverPublicKey: string;
  presharedKey?: string;
  allowedIps: string[];
  endpoint: string;
  persistentKeepalive?: number;
  mtu?: number;
}

export const PRIVATE_KEY_PLACEHOLDER = '__STORMVPN_CLIENT_PRIVATE_KEY__';

const LINE_INJECTION = /[\r\n[\]]/;

function assertSafe(label: string, value: string): string {
  if (LINE_INJECTION.test(value)) throw new Error(`Unsafe value for ${label}`);
  return value;
}

/**
 * Renders a wg-quick compatible client configuration.
 * All values are validated against newline/section injection.
 */
export function renderWireGuardConfig(input: WireGuardClientConfigInput): string {
  const lines = ['[Interface]'];
  lines.push(`PrivateKey = ${assertSafe('privateKey', input.privateKey ?? PRIVATE_KEY_PLACEHOLDER)}`);
  lines.push(`Address = ${input.addresses.map((a) => assertSafe('address', a)).join(', ')}`);
  if (input.dns.length > 0) {
    lines.push(`DNS = ${input.dns.map((d) => assertSafe('dns', d)).join(', ')}`);
  }
  if (input.mtu) lines.push(`MTU = ${input.mtu}`);
  lines.push('', '[Peer]');
  lines.push(`PublicKey = ${assertSafe('serverPublicKey', input.serverPublicKey)}`);
  if (input.presharedKey) lines.push(`PresharedKey = ${assertSafe('presharedKey', input.presharedKey)}`);
  lines.push(`AllowedIPs = ${input.allowedIps.map((a) => assertSafe('allowedIps', a)).join(', ')}`);
  lines.push(`Endpoint = ${assertSafe('endpoint', input.endpoint)}`);
  if (input.persistentKeepalive && input.persistentKeepalive > 0) {
    lines.push(`PersistentKeepalive = ${input.persistentKeepalive}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Inserts a locally generated private key into a server-rendered config template. */
export function injectPrivateKey(template: string, privateKey: string): string {
  if (!template.includes(PRIVATE_KEY_PLACEHOLDER)) {
    throw new Error('Config template does not contain a private key placeholder');
  }
  return template.replace(PRIVATE_KEY_PLACEHOLDER, assertSafe('privateKey', privateKey));
}

/** Formats an endpoint, bracketing IPv6 literals. */
export function formatEndpoint(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
