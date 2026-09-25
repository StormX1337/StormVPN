import type { AgentConfigResponse, AgentPeerConfig } from '@stormvpn/validation';

const SAFE = /^[A-Za-z0-9+/=.:,\s-]+$/;

function safe(value: string): string {
  if (!SAFE.test(value) || /[\r\n]/.test(value)) throw new Error('Refusing unsafe value in WireGuard config');
  return value;
}

/** `wg(8)` format used by `wg syncconf` (interface private key + peers). */
export function renderSyncConfig(privateKey: string, listenPort: number, peers: AgentPeerConfig[]): string {
  const lines = ['[Interface]', `PrivateKey = ${safe(privateKey)}`, `ListenPort = ${listenPort}`];
  for (const peer of peers) {
    lines.push('', '[Peer]', `PublicKey = ${safe(peer.publicKey)}`);
    if (peer.presharedKey) lines.push(`PresharedKey = ${safe(peer.presharedKey)}`);
    lines.push(`AllowedIPs = ${safe(peer.allowedIps.join(', '))}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * `wg-quick` interface file. NAT / forwarding are configured once by the node
 * setup script (nftables), so no PostUp hooks are needed here. Peers are
 * managed dynamically via `wg syncconf` and are not persisted to disk.
 */
export function renderInterfaceConfig(privateKey: string, config: AgentConfigResponse['interface']): string {
  const addresses = [config.addressV4, ...(config.addressV6 ? [config.addressV6] : [])];
  return [
    '# Managed by stormvpn-agent – manual changes will be overwritten.',
    '[Interface]',
    `Address = ${safe(addresses.join(', '))}`,
    `ListenPort = ${config.listenPort}`,
    `PrivateKey = ${safe(privateKey)}`,
    'SaveConfig = false',
    '',
  ].join('\n');
}
