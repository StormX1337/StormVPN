import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryFlag, estimateLatencyMs, getCountry, haversineKm } from '../geo';

describe('geo helpers', () => {
  it('has unique uppercase ISO codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
  });

  it('computes plausible distances and latencies', () => {
    const de = getCountry('de')!;
    const nl = getCountry('NL')!;
    const us = getCountry('US')!;
    const near = haversineKm(de, nl);
    const far = haversineKm(de, us);
    expect(near).toBeGreaterThan(300);
    expect(near).toBeLessThan(500);
    expect(estimateLatencyMs(far)).toBeGreaterThan(estimateLatencyMs(near));
  });

  it('renders flags', () => {
    expect(countryFlag('de')).toBe('🇩🇪');
  });
});
