import { describe, expect, it } from 'vitest';
import { generateWireGuardKeyPair, PRIVATE_KEY_PLACEHOLDER } from '@stormvpn/crypto';
import type { VPNPeer, VPNServer } from '@stormvpn/database';
import { buildClientConfig, resolveDns } from './config.builder';

const server = {
  id: 's1',
  name: 'DE-FRA-02',
  publicIpv4: '203.0.113.12',
  wireguardPort: 51820,
  wgSubnetV4: '10.80.0.0/20',
  wgSubnetV6: 'fd80:2::/64',
  dnsServers: [] as string[],
} as VPNServer;

const peer = { ipv4Address: '10.80.0.2', ipv6Address: 'fd80:2::2' } as VPNPeer;

describe('client config builder', () => {
  it('uses the node resolver by default and honours overrides', () => {
    expect(resolveDns(server, [])).toEqual(['10.80.0.1', 'fd80:2::1']);
    expect(resolveDns(server, ['9.9.9.9'])).toEqual(['9.9.9.9']);
    expect(resolveDns({ ...server, dnsServers: ['1.1.1.1'] }, ['9.9.9.9'])).toEqual(['1.1.1.1']);
  });

  it('renders a full tunnel config with PSK and a placeholder when no private key is known', () => {
    const serverKey = generateWireGuardKeyPair().publicKey;
    const { config, fileName } = buildClientConfig({
      server,
      serverPublicKey: serverKey,
      peer,
      presharedKey: 'PSK',
      allowedIps: ['0.0.0.0/0', '::/0'],
      defaultDns: [],
      keepalive: 25,
    });
    expect(fileName).toBe('stormvpn-de-fra-02.conf');
    expect(config).toContain(`PrivateKey = ${PRIVATE_KEY_PLACEHOLDER}`);
    expect(config).toContain('Address = 10.80.0.2/32, fd80:2::2/128');
    expect(config).toContain('DNS = 10.80.0.1, fd80:2::1');
    expect(config).toContain(`PublicKey = ${serverKey}`);
    expect(config).toContain('PresharedKey = PSK');
    expect(config).toContain('Endpoint = 203.0.113.12:51820');
    expect(config).toContain('PersistentKeepalive = 25');
  });
});
