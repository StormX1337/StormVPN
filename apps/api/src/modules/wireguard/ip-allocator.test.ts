import { describe, expect, it } from 'vitest';
import { allocateIpv4, gatewayAddress, hostIndex, ipv6ForHost } from './ip-allocator';

describe('ip allocator', () => {
  it('reserves network, gateway and broadcast', () => {
    expect(gatewayAddress('10.80.0.0/20')).toBe('10.80.0.1');
    expect(allocateIpv4('10.80.0.0/20', [])).toBe('10.80.0.2');
    expect(allocateIpv4('10.80.0.0/20', ['10.80.0.2', '10.80.0.3'])).toBe('10.80.0.4');
  });

  it('fills gaps and detects exhaustion', () => {
    expect(allocateIpv4('10.80.0.0/29', ['10.80.0.2', '10.80.0.4'])).toBe('10.80.0.3');
    const all = ['10.80.0.2', '10.80.0.3', '10.80.0.4', '10.80.0.5', '10.80.0.6'];
    expect(allocateIpv4('10.80.0.0/29', all)).toBeNull();
  });

  it('normalises misaligned subnets', () => {
    expect(gatewayAddress('10.80.5.7/20')).toBe('10.80.0.1');
  });

  it('derives matching IPv6 addresses', () => {
    const index = hostIndex('10.80.1.2', '10.80.0.0/20');
    expect(index).toBe(258);
    expect(ipv6ForHost('fd80:1::/64', index)).toBe('fd80:1::102');
    expect(ipv6ForHost('fd80:1::/64', 1)).toBe('fd80:1::1');
  });
});
