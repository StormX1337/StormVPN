import { apiEnvSchema, loadEnv, type ApiEnv } from '@stormvpn/config';

export type { ApiEnv };

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
