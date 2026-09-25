/** Dependency-free IP helpers usable in Node and browsers. */

export function parseIPv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIPv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

export function isIPv4(ip: string): boolean {
  return parseIPv4(ip) !== null;
}

/** Expands an IPv6 address into 8 hextets, or null when invalid. */
export function parseIPv6(ip: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(ip) || ip.includes(':::')) return null;
  const doubleColon = ip.split('::');
  if (doubleColon.length > 2) return null;
  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups: number[] = [];
    const items = segment.split(':');
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (i === items.length - 1 && item.includes('.')) {
        const v4 = parseIPv4(item);
        if (v4 === null) return null;
        groups.push(Math.floor(v4 / 65536), v4 % 65536);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null;
        groups.push(parseInt(item, 16));
      }
    }
    return groups;
  };
  const head = parseGroups(doubleColon[0]!);
  if (!head) return null;
  if (doubleColon.length === 1) return head.length === 8 ? head : null;
  const tail = parseGroups(doubleColon[1]!);
  if (!tail || head.length + tail.length > 7) return null;
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

export function isIPv6(ip: string): boolean {
  return parseIPv6(ip) !== null;
}

export function isIP(ip: string): boolean {
  return isIPv4(ip) || isIPv6(ip);
}

export interface ParsedCidr {
  version: 4 | 6;
  address: string;
  prefix: number;
}

export function parseCidr(cidr: string): ParsedCidr | null {
  const [address, prefixText, ...rest] = cidr.split('/');
  if (!address || prefixText === undefined || rest.length > 0 || !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (isIPv4(address) && prefix <= 32) return { version: 4, address, prefix };
  if (isIPv6(address) && prefix <= 128) return { version: 6, address, prefix };
  return null;
}

export function isCidr(value: string): boolean {
  return parseCidr(value) !== null;
}

/** Network base address and size of an IPv4 CIDR. */
export function ipv4CidrRange(cidr: string): { network: number; size: number; prefix: number } | null {
  const parsed = parseCidr(cidr);
  if (!parsed || parsed.version !== 4) return null;
  const size = 2 ** (32 - parsed.prefix);
  const network = Math.floor(parseIPv4(parsed.address)! / size) * size;
  return { network, size, prefix: parsed.prefix };
}

export function ipv4InCidr(ip: string, cidr: string): boolean {
  const range = ipv4CidrRange(cidr);
  const value = parseIPv4(ip);
  if (!range || value === null) return false;
  return value >= range.network && value < range.network + range.size;
}

const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'];

export function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_V4.some((cidr) => ipv4InCidr(ip, cidr));
}
