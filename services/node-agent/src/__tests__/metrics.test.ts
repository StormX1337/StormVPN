import { describe, expect, it } from 'vitest';
import { cpuPercent, parseMeminfo, parseProcStat } from '../metrics/system';
import { PeerTrafficTracker } from '../metrics/traffic';
import { detectPublicIps, parseDefaultRoute } from '../network';
import { renderMetrics } from '../prometheus';
import { isNewerVersion } from '../version';

describe('procfs parsers', () => {
  it('computes CPU usage from /proc/stat samples', () => {
    const a = parseProcStat('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1');
    const b = parseProcStat('cpu  200 0 200 1400 0 0 0 0 0 0');
    expect(a).toEqual({ idle: 800, total: 1000 });
    expect(cpuPercent(a, b)).toBe(25);
  });

  it('parses meminfo', () => {
    expect(parseMeminfo('MemTotal:  8000 kB\nMemFree: 100 kB\nMemAvailable:  2000 kB\n')).toEqual({
      totalBytes: 8_192_000,
      availableBytes: 2_048_000,
    });
  });

  it('finds the default route interface', () => {
    const route =
      'Iface\tDestination\tGateway\tFlags\nwg0\t0050A00A\t00000000\t0001\neth0\t00000000\t0101A8C0\t0003\n';
    expect(parseDefaultRoute(route)).toBe('eth0');
  });
});

describe('PeerTrafficTracker', () => {
  const now = 1_800_000_000;
  const peer = (rx: number, tx: number, handshake = now - 10) => ({
    publicKey: 'A=',
    endpoint: null,
    allowedIps: [],
    latestHandshake: handshake,
    rxBytes: rx,
    txBytes: tx,
  });

  it('reports deltas and handles counter resets', () => {
    const tracker = new PeerTrafficTracker();
    expect(tracker.collect([peer(100, 200)], now)).toEqual([
      { publicKey: 'A=', latestHandshake: now - 10, rxBytesDelta: 100, txBytesDelta: 200 },
    ]);
    expect(tracker.collect([peer(150, 260)], now)[0]).toMatchObject({
      rxBytesDelta: 50,
      txBytesDelta: 60,
    });
    expect(tracker.collect([peer(20, 30)], now)[0]).toMatchObject({
      rxBytesDelta: 20,
      txBytesDelta: 30,
    });
  });

  it('skips idle peers and re-sends deltas after a failed report', () => {
    const tracker = new PeerTrafficTracker();
    expect(tracker.collect([peer(0, 0, 0)], now)).toEqual([]);
    const stats = tracker.collect([peer(500, 500)], now);
    tracker.rollback(stats);
    expect(tracker.collect([peer(600, 600)], now)[0]).toMatchObject({
      rxBytesDelta: 600,
      txBytesDelta: 600,
    });
  });
});

describe('misc', () => {
  it('compares versions', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
  });

  it('detects public IPs with override and echo fallbacks', async () => {
    expect(
      await detectPublicIps({ ipv4Override: '203.0.113.5', echoUrls: [], timeoutMs: 100 }),
    ).toEqual({ ipv4: '203.0.113.5' });
    const fetchImpl = (async (url: string) =>
      url.includes('bad')
        ? new Response('<html>', { status: 200 })
        : new Response('198.51.100.9\n')) as unknown as typeof fetch;
    expect(
      await detectPublicIps({
        echoUrls: ['https://bad.test', 'https://good.test'],
        timeoutMs: 100,
        fetchImpl,
      }),
    ).toEqual({ ipv4: '198.51.100.9' });
  });

  it('renders Prometheus metrics', () => {
    const text = renderMetrics(
      {
        up: true,
        appliedRevision: 7,
        peers: 3,
        activePeers: 2,
        cpuPercent: 1,
        memoryPercent: 2,
        diskPercent: 3,
        rxBps: 4,
        txBps: 5,
        lastHeartbeatSuccess: 6,
        heartbeatFailures: 0,
      },
      { server: 'DE-FRA-01' },
    );
    expect(text).toContain('stormvpn_agent_wireguard_up{server="DE-FRA-01"} 1');
    expect(text).toContain('# TYPE stormvpn_agent_heartbeat_failures_total counter');
  });
});
