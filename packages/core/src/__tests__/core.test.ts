import { describe, expect, it } from 'vitest';
import {
  computeRiskScore,
  computeServerLoad,
  isServerAllowed,
  startOfUtcMonth,
  uuidv7,
} from '../index';

describe('computeServerLoad', () => {
  const base = {
    activeConnections: 0,
    capacity: 500,
    cpuPercent: 0,
    rxBps: 0,
    txBps: 0,
    bandwidthCapacityMbps: 1000,
  };

  it('uses the most constrained resource', () => {
    expect(computeServerLoad({ ...base, activeConnections: 155 })).toBe(31);
    expect(computeServerLoad({ ...base, activeConnections: 10, cpuPercent: 92 })).toBe(92);
    // 60 MB/s = 480 Mbit/s of 1 Gbit/s
    expect(computeServerLoad({ ...base, txBps: 60_000_000 })).toBe(48);
  });

  it('clamps to 0..100 and treats zero capacity as full', () => {
    expect(computeServerLoad({ ...base, activeConnections: 900 })).toBe(100);
    expect(computeServerLoad({ ...base, capacity: 0 })).toBe(100);
  });
});

describe('isServerAllowed', () => {
  it('honours countries and server classes', () => {
    const free = { allowedCountries: ['DE', 'NL'], serverClasses: ['STANDARD'] };
    expect(isServerAllowed(free, { countryCode: 'DE', serverClass: 'STANDARD' })).toBe(true);
    expect(isServerAllowed(free, { countryCode: 'US', serverClass: 'STANDARD' })).toBe(false);
    expect(isServerAllowed(free, { countryCode: 'DE', serverClass: 'PREMIUM' })).toBe(false);
    const ultra = { allowedCountries: [], serverClasses: ['STANDARD', 'PREMIUM', 'STREAMING'] };
    expect(isServerAllowed(ultra, { countryCode: 'US', serverClass: 'STREAMING' })).toBe(true);
  });
});

describe('computeRiskScore', () => {
  it('weights security events, flags and excess connections', () => {
    expect(
      computeRiskScore({
        eventCounts: { LOGIN_FAILED: 4, REFRESH_TOKEN_REUSE: 1 },
        flagScore: 10,
        concurrentConnections: 5,
        maxSessions: 3,
        distinctServersLastHour: 12,
      }),
    ).toBe(4 + 20 + 10 + 20 + 10);
  });
});

describe('helpers', () => {
  it('creates time ordered RFC 9562 v7 UUIDs', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('computes the UTC month start', () => {
    expect(startOfUtcMonth(new Date('2026-09-25T23:59:00Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
});
