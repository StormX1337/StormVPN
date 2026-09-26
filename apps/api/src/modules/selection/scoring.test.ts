import { describe, expect, it } from 'vitest';
import { type Candidate, ineligibility, type SelectionContext, selectServer } from './scoring';

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  id: overrides.name ?? 'id',
  name: 'DE-FRA-01',
  countryCode: 'DE',
  city: 'Frankfurt',
  region: 'EUROPE',
  serverClass: 'STANDARD',
  latitude: 50.11,
  longitude: 8.68,
  status: 'ONLINE',
  load: 10,
  activeConnections: 10,
  capacity: 500,
  ...overrides,
});

const context = (overrides: Partial<SelectionContext> = {}): SelectionContext => ({
  allowedCountries: [],
  serverClasses: ['STANDARD', 'PREMIUM'],
  planPriority: 10,
  filters: {},
  preferences: { favoriteServerIds: new Set() },
  clientLocation: { lat: 52.52, lon: 13.4 },
  overloadThreshold: 85,
  ...overrides,
});

describe('server selection / load balancing', () => {
  it('prefers the least loaded server in a location (spec example)', () => {
    const servers = [
      candidate({ name: 'DE-FRA-01', load: 92, activeConnections: 460 }),
      candidate({ name: 'DE-FRA-02', load: 31, activeConnections: 155 }),
      candidate({ name: 'DE-FRA-03', load: 45, activeConnections: 225 }),
    ];
    for (let i = 0; i < 20; i++) {
      const result = selectServer(servers, context(), Math.random);
      expect(result?.selected.candidate.name).toBe('DE-FRA-02');
    }
  });

  it('never assigns overloaded, full, offline or maintenance nodes', () => {
    const ctx = context();
    expect(ineligibility(candidate({ load: 85 }), ctx)).toBe('overloaded');
    expect(ineligibility(candidate({ activeConnections: 500 }), ctx)).toBe('full');
    expect(ineligibility(candidate({ status: 'OFFLINE' }), ctx)).toBe('offline');
    expect(ineligibility(candidate({ status: 'MAINTENANCE' }), ctx)).toBe('offline');
    expect(selectServer([candidate({ load: 99 })], ctx)).toBeNull();
  });

  it('respects plan countries and server classes', () => {
    const ctx = context({ allowedCountries: ['NL'], serverClasses: ['STANDARD'] });
    expect(ineligibility(candidate({ countryCode: 'DE' }), ctx)).toBe('plan_country');
    expect(ineligibility(candidate({ countryCode: 'NL', serverClass: 'STREAMING' }), ctx)).toBe(
      'plan_class',
    );
    expect(ineligibility(candidate({ countryCode: 'NL' }), ctx)).toBeNull();
  });

  it('prefers lower latency when load is similar', () => {
    const servers = [
      candidate({
        name: 'US-NYC-01',
        countryCode: 'US',
        region: 'NORTH_AMERICA',
        latitude: 40.71,
        longitude: -74,
        load: 20,
      }),
      candidate({ name: 'DE-BER-01', latitude: 52.52, longitude: 13.4, load: 25 }),
    ];
    expect(selectServer(servers, context())?.selected.candidate.name).toBe('DE-BER-01');
  });

  it('uses client measured latencies over geo estimates', () => {
    const a = candidate({ name: 'A', id: 'a', load: 20 });
    const b = candidate({ name: 'B', id: 'b', load: 20 });
    const result = selectServer([a, b], context({ latencies: { a: 180, b: 12 } }));
    expect(result?.selected.candidate.name).toBe('B');
  });

  it('falls back to degraded nodes only when nothing healthy is available', () => {
    const degraded = candidate({ name: 'DEG', status: 'DEGRADED', load: 5 });
    const healthy = candidate({ name: 'OK', load: 60, activeConnections: 300 });
    expect(selectServer([degraded, healthy], context())?.selected.candidate.name).toBe('OK');
    expect(selectServer([degraded], context())?.selected.candidate.name).toBe('DEG');
  });

  it('reserves headroom near the overload threshold for high priority plans', () => {
    const busy = candidate({ name: 'BUSY', id: 'busy', load: 80, activeConnections: 100 });
    const far = candidate({
      name: 'FAR',
      id: 'far',
      load: 30,
      activeConnections: 100,
      latitude: 40.71,
      longitude: -74,
    });
    expect(selectServer([busy, far], context({ planPriority: 0 }))?.selected.candidate.name).toBe(
      'FAR',
    );
    const priority = selectServer(
      [busy, far],
      context({ planPriority: 100, latencies: { busy: 5, far: 180 } }),
    );
    expect(priority?.selected.candidate.name).toBe('BUSY');
  });

  it('applies location filters and favourites', () => {
    const nl = candidate({
      name: 'NL-AMS-01',
      id: 'nl',
      countryCode: 'NL',
      city: 'Amsterdam',
      load: 30,
    });
    const de = candidate({ name: 'DE-FRA-02', id: 'de', load: 10 });
    expect(
      selectServer([nl, de], context({ filters: { country: 'NL' } }))?.selected.candidate.name,
    ).toBe('NL-AMS-01');
    const fav = context({
      preferences: { favoriteServerIds: new Set(['nl']), preferredCountry: 'NL' },
    });
    expect(selectServer([nl, de], fav)?.selected.candidate.name).toBe('NL-AMS-01');
  });
});
