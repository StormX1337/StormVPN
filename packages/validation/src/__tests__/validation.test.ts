import { describe, expect, it } from 'vitest';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import {
  agentHeartbeatSchema,
  couponCreateSchema,
  createConnectionSchema,
  emailSchema,
  ipv4InCidr,
  isCidr,
  isIPv6,
  parseIPv4,
  formatIPv4,
  passwordSchema,
  planCreateSchema,
  planUpdateSchema,
  registerSchema,
  serverCreateSchema,
  serverUpdateSchema,
} from '../index';

describe('net helpers', () => {
  it('parses and formats IPv4', () => {
    expect(parseIPv4('10.80.0.1')).toBe(0x0a500001);
    expect(formatIPv4(0x0a500001)).toBe('10.80.0.1');
    expect(parseIPv4('10.80.0.256')).toBeNull();
    expect(parseIPv4('010.1.1.1')).toBeNull();
  });

  it('validates IPv6 and CIDRs', () => {
    expect(isIPv6('fd80::1')).toBe(true);
    expect(isIPv6('2001:db8:0:0:0:0:2:1')).toBe(true);
    expect(isIPv6('::ffff:192.0.2.1')).toBe(true);
    expect(isIPv6('1::2::3')).toBe(false);
    expect(isCidr('0.0.0.0/0')).toBe(true);
    expect(isCidr('::/0')).toBe(true);
    expect(isCidr('10.0.0.0/33')).toBe(false);
    expect(ipv4InCidr('10.80.15.254', '10.80.0.0/20')).toBe(true);
    expect(ipv4InCidr('10.80.16.1', '10.80.0.0/20')).toBe(false);
  });
});

describe('auth schemas', () => {
  it('normalises emails', () => {
    expect(emailSchema.parse('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('enforces password policy', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it('requires accepting terms and rejects markup in names', () => {
    expect(
      registerSchema.safeParse({
        email: 'a@b.de',
        password: 'correct horse battery',
        acceptTerms: false,
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: 'a@b.de',
        password: 'correct horse battery',
        acceptTerms: true,
        name: '<script>',
      }).success,
    ).toBe(false);
  });
});

describe('vpn schemas', () => {
  const deviceId = '0190a5b4-0000-7000-8000-000000000001';

  it('accepts a quick connect request with a client key', () => {
    const { publicKey } = generateWireGuardKeyPair();
    const parsed = createConnectionSchema.parse({ deviceId, publicKey, country: 'de' });
    expect(parsed.country).toBe('DE');
    expect(parsed.serverId).toBeUndefined();
  });

  it('rejects invalid keys and allowed IPs', () => {
    expect(createConnectionSchema.safeParse({ deviceId, publicKey: 'nope' }).success).toBe(false);
    expect(createConnectionSchema.safeParse({ deviceId, allowedIps: ['1.2.3.4/40'] }).success).toBe(
      false,
    );
  });
});

describe('admin schemas', () => {
  it('validates server naming and subnets', () => {
    const base = {
      name: 'de-fra-01',
      hostname: 'de-fra-01.nodes.stormvpn.example',
      countryCode: 'de',
      city: 'Frankfurt',
      region: 'EUROPE',
      publicIpv4: '203.0.113.10',
    };
    const parsed = serverCreateSchema.parse(base);
    expect(parsed.name).toBe('DE-FRA-01');
    expect(parsed.wgSubnetV4).toBe('10.80.0.0/20');
    expect(serverCreateSchema.safeParse({ ...base, name: 'frankfurt' }).success).toBe(false);
    expect(serverCreateSchema.safeParse({ ...base, wgSubnetV4: '10.0.0.0/8' }).success).toBe(false);
  });

  it('requires exactly one discount type on coupons', () => {
    expect(
      couponCreateSchema.safeParse({ code: 'storm', percentOff: 20, amountOffCents: 100 }).success,
    ).toBe(false);
    expect(couponCreateSchema.safeParse({ code: 'storm', amountOffCents: 100 }).success).toBe(
      false,
    );
    expect(couponCreateSchema.parse({ code: 'storm', percentOff: 20 }).code).toBe('STORM');
  });

  it('never injects defaults into partial updates', () => {
    expect(planUpdateSchema.parse({ priceCents: 1599 })).toEqual({ priceCents: 1599 });
    expect(serverUpdateSchema.parse({ capacity: 800 })).toEqual({ capacity: 800 });
  });

  it('applies plan defaults', () => {
    const plan = planCreateSchema.parse({
      slug: 'pro',
      name: 'Pro',
      priceCents: 999,
      maxDevices: 5,
      maxSessions: 5,
    });
    expect(plan.serverClasses).toEqual(['STANDARD']);
    expect(plan.currency).toBe('eur');
  });
});

describe('agent heartbeat schema', () => {
  it('bounds metrics', () => {
    const heartbeat = {
      agentVersion: '1.0.0',
      metrics: {
        cpuPercent: 150,
        memoryPercent: 10,
        memoryTotalBytes: 1,
        diskPercent: 1,
        rxBps: 0,
        txBps: 0,
        uptimeSeconds: 1,
        loadAverage: [0, 0, 0],
      },
      wireguard: {
        interfaceUp: true,
        listenPort: 51820,
        peerCount: 0,
        appliedRevision: 0,
        totalRxBytes: 0,
        totalTxBytes: 0,
      },
    };
    expect(agentHeartbeatSchema.safeParse(heartbeat).success).toBe(false);
    heartbeat.metrics.cpuPercent = 50;
    expect(agentHeartbeatSchema.safeParse(heartbeat).success).toBe(true);
  });
});
