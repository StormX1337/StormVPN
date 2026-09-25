import { formatIPv4, ipv4CidrRange, parseCidr, parseIPv4, parseIPv6 } from '@stormvpn/validation';

/** The first usable address of the client subnet is the node's WireGuard interface (e.g. 10.80.0.1). */
export function gatewayAddress(subnetV4: string): string {
  const range = ipv4CidrRange(subnetV4);
  if (!range) throw new Error(`Invalid IPv4 subnet ${subnetV4}`);
  return formatIPv4(range.network + 1);
}

export function subnetPrefix(subnet: string): number {
  const parsed = parseCidr(subnet);
  if (!parsed) throw new Error(`Invalid subnet ${subnet}`);
  return parsed.prefix;
}

/**
 * Lowest free host address in the subnet, skipping network, gateway and
 * broadcast addresses. Returns null when the subnet is exhausted.
 */
export function allocateIpv4(subnetV4: string, used: Iterable<string>): string | null {
  const range = ipv4CidrRange(subnetV4);
  if (!range) throw new Error(`Invalid IPv4 subnet ${subnetV4}`);
  const taken = new Set<number>();
  for (const address of used) {
    const value = parseIPv4(address);
    if (value !== null) taken.add(value);
  }
  const first = range.network + 2;
  const last = range.network + range.size - 2;
  for (let candidate = first; candidate <= last; candidate++) {
    if (!taken.has(candidate)) return formatIPv4(candidate);
  }
  return null;
}

export function hostIndex(ipv4: string, subnetV4: string): number {
  const range = ipv4CidrRange(subnetV4);
  const value = parseIPv4(ipv4);
  if (!range || value === null) throw new Error('Invalid address');
  return value - range.network;
}

function formatIPv6(hextets: number[]): string {
  // RFC 5952: compress the longest run of zero hextets.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (hextets[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && hextets[j] === 0) j++;
    if (j - i > bestLength && j - i > 1) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const parts = hextets.map((h) => h.toString(16));
  if (bestStart === -1) return parts.join(':');
  const head = parts.slice(0, bestStart).join(':');
  const tail = parts.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/** Maps an IPv4 host index into the IPv6 subnet so both addresses of a peer correspond. */
export function ipv6ForHost(subnetV6: string, index: number): string {
  const parsed = parseCidr(subnetV6);
  const hextets = parsed ? parseIPv6(parsed.address) : null;
  if (!parsed || parsed.version !== 6 || !hextets || parsed.prefix > 96) throw new Error(`Invalid IPv6 subnet ${subnetV6}`);
  const result = [...hextets];
  result[6] = Math.floor(index / 65536) & 0xffff;
  result[7] = index & 0xffff;
  return formatIPv6(result);
}
