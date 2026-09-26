import type { DbClient } from '@stormvpn/database';
import type { SystemSettingsDto } from '@stormvpn/types';

export type SystemSettings = SystemSettingsDto;

export const DEFAULT_SETTINGS: SystemSettings = {
  maintenanceMode: false,
  maintenanceMessage: null,
  registrationEnabled: true,
  /** Empty = use the WireGuard gateway of each server (node-local resolver). */
  defaultDns: [],
  abuseAutoSuspendScore: 100,
  maxConfigGenerationsPerHour: 30,
  serverOverloadThreshold: 85,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SystemSettings)[];

/**
 * Runtime-tunable settings stored in `system_settings` with typed defaults.
 * Values are cached per process for a few seconds.
 */
export class SettingsService {
  private cache: { value: SystemSettings; expiresAt: number } | undefined;

  constructor(
    private readonly db: DbClient,
    private readonly ttlMs = 5_000,
  ) {}

  async get(): Promise<SystemSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const rows = await this.db.systemSetting.findMany({ where: { key: { in: KEYS } } });
    const value: SystemSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      (value as unknown as Record<string, unknown>)[row.key] = row.value;
    }
    this.cache = { value, expiresAt: Date.now() + this.ttlMs };
    return value;
  }

  async update(
    patch: Partial<SystemSettings>,
    updatedById: string | null,
  ): Promise<SystemSettings> {
    const entries = Object.entries(patch).filter(
      ([key, value]) => KEYS.includes(key as keyof SystemSettings) && value !== undefined,
    );
    for (const [key, value] of entries) {
      const json = value as never;
      await this.db.systemSetting.upsert({
        where: { key },
        create: { key, value: json, updatedById },
        update: { value: json, updatedById },
      });
    }
    this.cache = undefined;
    return this.get();
  }

  invalidate(): void {
    this.cache = undefined;
  }
}
