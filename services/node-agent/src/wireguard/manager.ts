import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@stormvpn/config';
import type { AgentConfigResponse } from '@stormvpn/validation';
import type { CommandRunner } from '../exec';
import type { StateStore } from '../state';
import { parseWgDump, type WgInterfaceStatus } from './dump';
import { renderInterfaceConfig, renderSyncConfig } from './render';

export interface WireGuardManager {
  isUp(): Promise<boolean>;
  apply(config: AgentConfigResponse): Promise<void>;
  status(): Promise<WgInterfaceStatus | null>;
}

/** Real WireGuard control via wireguard-tools (`wg`, `wg-quick`). */
export class WgToolsManager implements WireGuardManager {
  constructor(
    private readonly iface: string,
    private readonly configDir: string,
    private readonly runner: CommandRunner,
    private readonly state: StateStore,
    private readonly logger: Logger,
  ) {}

  async isUp(): Promise<boolean> {
    try {
      await this.runner.run('wg', ['show', this.iface, 'public-key']);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureInterface(config: AgentConfigResponse, privateKey: string): Promise<void> {
    const path = join(this.configDir, `${this.iface}.conf`);
    const desired = renderInterfaceConfig(privateKey, config.interface);
    const current = await readFile(path, 'utf8').catch(() => '');
    const changed = current !== desired;
    if (changed) {
      await writeFile(path, desired, { mode: 0o600 });
      this.logger.info({ path }, 'wrote WireGuard interface config');
    }
    const up = await this.isUp();
    if (up && changed) await this.runner.run('wg-quick', ['down', this.iface], { timeoutMs: 30_000 });
    if (!up || changed) {
      await this.runner.run('wg-quick', ['up', this.iface], { timeoutMs: 30_000 });
      this.logger.info({ iface: this.iface }, 'WireGuard interface up');
    }
  }

  /**
   * Atomically converges the kernel peer table to the desired set with
   * `wg syncconf` – unchanged peers keep their sessions, removed peers are
   * dropped instantly, new peers are added.
   */
  async apply(config: AgentConfigResponse): Promise<void> {
    const { privateKey } = await this.state.serverKeys();
    await this.ensureInterface(config, privateKey);
    const file = await this.state.writeTemp('wg-sync.conf', renderSyncConfig(privateKey, config.interface.listenPort, config.peers));
    try {
      await this.runner.run('wg', ['syncconf', this.iface, file], { timeoutMs: 60_000 });
    } finally {
      await unlink(file).catch(() => undefined);
    }
  }

  async status(): Promise<WgInterfaceStatus | null> {
    try {
      const { stdout } = await this.runner.run('wg', ['show', this.iface, 'dump']);
      return parseWgDump(stdout);
    } catch {
      return null;
    }
  }
}

/** In-memory simulation for development environments without WireGuard. */
export class DryRunManager implements WireGuardManager {
  private config: AgentConfigResponse | null = null;
  private readonly started = Math.floor(Date.now() / 1000);

  constructor(private readonly logger: Logger) {}

  async isUp(): Promise<boolean> {
    return this.config !== null;
  }

  async apply(config: AgentConfigResponse): Promise<void> {
    this.config = config;
    this.logger.info({ revision: config.revision, peers: config.peers.length }, '[dry-run] applied WireGuard config');
  }

  async status(): Promise<WgInterfaceStatus | null> {
    if (!this.config) return null;
    return { publicKey: 'dry-run', listenPort: this.config.interface.listenPort, peers: this.config.peers.map((peer) => ({ publicKey: peer.publicKey, endpoint: null, allowedIps: peer.allowedIps, latestHandshake: this.started, rxBytes: 0, txBytes: 0 })) };
  }
}
