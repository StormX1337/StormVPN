import { readFile } from 'node:fs/promises';
import type { CommandRunner } from './exec';
import type { WireGuardManager } from './wireguard/manager';

export type HealthReport = Record<string, { ok: boolean; message?: string }>;

/**
 * Local node health: WireGuard up, IP forwarding enabled, NAT masquerading
 * present (nftables or iptables). Failing checks mark the node DEGRADED so it
 * stops receiving new users.
 */
export class HealthChecker {
  constructor(
    private readonly wireguard: WireGuardManager,
    private readonly runner: CommandRunner,
    private readonly dryRun: boolean,
  ) {}

  private async ipForward(): Promise<{ ok: boolean; message?: string }> {
    try {
      const value = (await readFile('/proc/sys/net/ipv4/ip_forward', 'utf8')).trim();
      return value === '1' ? { ok: true } : { ok: false, message: 'net.ipv4.ip_forward is disabled' };
    } catch {
      return { ok: false, message: 'cannot read ip_forward' };
    }
  }

  private async nat(): Promise<{ ok: boolean; message?: string }> {
    for (const [command, args] of [
      ['nft', ['list', 'ruleset']],
      ['iptables-save', ['-t', 'nat']],
    ] as const) {
      try {
        const { stdout } = await this.runner.run(command, [...args]);
        if (/masquerade/i.test(stdout)) return { ok: true };
      } catch {
        /* tool not installed – try the next one */
      }
    }
    return { ok: false, message: 'no masquerade rule found' };
  }

  async run(): Promise<HealthReport> {
    const wireguard = (await this.wireguard.isUp()) ? { ok: true } : { ok: false, message: 'interface down' };
    if (this.dryRun) return { wireguard, dryRun: { ok: true, message: 'simulated WireGuard' } };
    const [ipForward, nat] = await Promise.all([this.ipForward(), this.nat()]);
    return { wireguard, ipForward, nat };
  }
}
