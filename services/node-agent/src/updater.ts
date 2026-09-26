import type { Logger } from '@stormvpn/config';
import type { CommandRunner } from './exec';
import { AGENT_VERSION, isNewerVersion } from './version';

/**
 * Prepared automatic updates: the control plane announces the desired agent
 * version; when auto-update is enabled the configured update script downloads
 * the release, verifies its SHA-256 checksum/signature and restarts the
 * service (see infra/wireguard/update-agent.sh).
 */
export class Updater {
  private attempted = new Set<string>();

  constructor(
    private readonly enabled: boolean,
    private readonly command: string,
    private readonly runner: CommandRunner,
    private readonly logger: Logger,
  ) {}

  async check(
    desiredVersion: string | null,
    updateUrl: string | null,
  ): Promise<'up-to-date' | 'available' | 'started' | 'failed'> {
    if (!desiredVersion || !isNewerVersion(desiredVersion, AGENT_VERSION)) return 'up-to-date';
    if (!this.enabled || !updateUrl) {
      if (!this.attempted.has(desiredVersion))
        this.logger.warn({ current: AGENT_VERSION, desiredVersion }, 'agent update available');
      this.attempted.add(desiredVersion);
      return 'available';
    }
    if (this.attempted.has(desiredVersion)) return 'failed';
    this.attempted.add(desiredVersion);
    try {
      this.logger.info({ desiredVersion }, 'starting agent self-update');
      await this.runner.run(this.command, [desiredVersion, updateUrl], { timeoutMs: 300_000 });
      return 'started';
    } catch (error) {
      this.logger.error({ err: error, desiredVersion }, 'agent update failed');
      return 'failed';
    }
  }
}
