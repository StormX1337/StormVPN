import { readFile } from 'node:fs/promises';
import { isIPv4, isIPv6 } from '@stormvpn/validation';

/** Default-route interface from /proc/net/route (destination 00000000). */
export function parseDefaultRoute(content: string): string | null {
  for (const line of content.split('\n').slice(1)) {
    const [iface, destination, , flags] = line.trim().split(/\s+/);
    if (iface && destination === '00000000' && (Number.parseInt(flags ?? '0', 16) & 0x2) !== 0)
      return iface;
  }
  return null;
}

export async function detectWanInterface(override?: string): Promise<string | null> {
  if (override) return override;
  try {
    return parseDefaultRoute(await readFile('/proc/net/route', 'utf8'));
  } catch {
    return null;
  }
}

/** Public IP detection: explicit override first, then HTTPS echo services. */
export async function detectPublicIps(options: {
  ipv4Override?: string;
  ipv6Override?: string;
  echoUrls: string[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ipv4?: string; ipv6?: string }> {
  const result: { ipv4?: string; ipv6?: string } = {};
  if (options.ipv4Override && isIPv4(options.ipv4Override)) result.ipv4 = options.ipv4Override;
  if (options.ipv6Override && isIPv6(options.ipv6Override)) result.ipv6 = options.ipv6Override;
  if (result.ipv4) return result;
  const fetcher = options.fetchImpl ?? fetch;
  for (const url of options.echoUrls) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(options.timeoutMs) });
      const text = (await response.text()).trim();
      if (response.ok && isIPv4(text)) {
        result.ipv4 = text;
        break;
      }
    } catch {
      /* try the next echo service */
    }
  }
  return result;
}
