import { formatEndpoint, renderWireGuardConfig } from '@stormvpn/crypto';
import type { VPNPeer, VPNServer } from '@stormvpn/database';
import { gatewayAddress } from './ip-allocator';

export interface ClientConfigInput {
  server: VPNServer;
  serverPublicKey: string;
  peer: VPNPeer;
  presharedKey: string;
  privateKey?: string;
  allowedIps: string[];
  defaultDns: string[];
  keepalive: number;
}

/** DNS precedence: per-server override → global setting → node-local resolver on the gateway address. */
export function resolveDns(server: VPNServer, defaultDns: string[]): string[] {
  if (server.dnsServers.length > 0) return server.dnsServers;
  if (defaultDns.length > 0) return defaultDns;
  const dns = [gatewayAddress(server.wgSubnetV4)];
  if (server.wgSubnetV6) {
    const prefix = server.wgSubnetV6.split('/')[0]!;
    dns.push(prefix.endsWith('::') ? `${prefix}1` : prefix);
  }
  return dns;
}

export function buildClientConfig(input: ClientConfigInput): { config: string; fileName: string } {
  const { server, peer } = input;
  const addresses = [`${peer.ipv4Address}/32`];
  if (peer.ipv6Address) addresses.push(`${peer.ipv6Address}/128`);
  const config = renderWireGuardConfig({
    privateKey: input.privateKey,
    addresses,
    dns: resolveDns(server, input.defaultDns),
    serverPublicKey: input.serverPublicKey,
    presharedKey: input.presharedKey,
    allowedIps: input.allowedIps,
    endpoint: formatEndpoint(server.publicIpv4, server.wireguardPort),
    persistentKeepalive: input.keepalive,
  });
  return { config, fileName: `stormvpn-${server.name.toLowerCase()}.conf` };
}
