import { describe, expect, it } from 'vitest';
import {
  deriveWireGuardPublicKey,
  formatEndpoint,
  generatePresharedKey,
  generateWireGuardKeyPair,
  injectPrivateKey,
  isValidWireGuardKey,
  PRIVATE_KEY_PLACEHOLDER,
  renderWireGuardConfig,
} from '../index';

describe('WireGuard keys', () => {
  it('generates valid, clamped key pairs whose public key can be re-derived', () => {
    const pair = generateWireGuardKeyPair();
    expect(isValidWireGuardKey(pair.privateKey)).toBe(true);
    expect(isValidWireGuardKey(pair.publicKey)).toBe(true);
    expect(deriveWireGuardPublicKey(pair.privateKey)).toBe(pair.publicKey);
    const secret = Buffer.from(pair.privateKey, 'base64');
    expect(secret[0]! & 7).toBe(0);
    expect(secret[31]! & 128).toBe(0);
    expect(secret[31]! & 64).toBe(64);
  });

  it('matches the RFC 7748 x25519 test vector', () => {
    const alicePrivate = Buffer.from(
      '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
      'hex',
    ).toString('base64');
    const expected = Buffer.from(
      '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
      'hex',
    ).toString('base64');
    expect(deriveWireGuardPublicKey(alicePrivate)).toBe(expected);
  });

  it('rejects malformed keys', () => {
    expect(isValidWireGuardKey('abc')).toBe(false);
    expect(isValidWireGuardKey(`${'A'.repeat(43)}=\n`)).toBe(false);
    expect(isValidWireGuardKey(generatePresharedKey())).toBe(true);
  });
});

describe('WireGuard config rendering', () => {
  const base = {
    addresses: ['10.80.0.2/32'],
    dns: ['10.80.0.1'],
    serverPublicKey: generateWireGuardKeyPair().publicKey,
    allowedIps: ['0.0.0.0/0', '::/0'],
    endpoint: formatEndpoint('203.0.113.10', 51820),
    persistentKeepalive: 25,
  };

  it('renders the documented config layout', () => {
    const config = renderWireGuardConfig({ ...base, privateKey: 'PRIV' });
    expect(config).toBe(
      [
        '[Interface]',
        'PrivateKey = PRIV',
        'Address = 10.80.0.2/32',
        'DNS = 10.80.0.1',
        '',
        '[Peer]',
        `PublicKey = ${base.serverPublicKey}`,
        'AllowedIPs = 0.0.0.0/0, ::/0',
        'Endpoint = 203.0.113.10:51820',
        'PersistentKeepalive = 25',
        '',
      ].join('\n'),
    );
  });

  it('renders templates without private key and injects locally generated keys', () => {
    const template = renderWireGuardConfig(base);
    expect(template).toContain(PRIVATE_KEY_PLACEHOLDER);
    const pair = generateWireGuardKeyPair();
    expect(injectPrivateKey(template, pair.privateKey)).toContain(
      `PrivateKey = ${pair.privateKey}`,
    );
  });

  it('prevents config injection', () => {
    expect(() => renderWireGuardConfig({ ...base, dns: ['1.1.1.1\n[Peer]'] })).toThrow(/Unsafe/);
  });

  it('brackets IPv6 endpoints', () => {
    expect(formatEndpoint('2001:db8::1', 51820)).toBe('[2001:db8::1]:51820');
  });
});
