import { z } from 'zod';
import { envBoolean, envList, loadEnv } from '@stormvpn/config';

export const agentEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    STORMVPN_API_URL: z.string().url(),
    STORMVPN_ENROLLMENT_TOKEN: z.string().min(20).optional(),
    STORMVPN_STATE_DIR: z.string().default('/var/lib/stormvpn-agent'),
    WG_INTERFACE: z
      .string()
      .regex(/^[a-zA-Z0-9_=+.-]{1,15}$/)
      .default('wg0'),
    WG_CONFIG_DIR: z.string().default('/etc/wireguard'),
    /** Uplink interface used for NAT checks and bandwidth metrics (auto-detected when empty). */
    WAN_INTERFACE: z.string().optional(),
    PUBLIC_IPV4: z.string().optional(),
    PUBLIC_IPV6: z.string().optional(),
    PUBLIC_IP_ECHO_URLS: envList(['https://api.ipify.org', 'https://ipv4.icanhazip.com']),
    METRICS_ENABLED: envBoolean(true),
    METRICS_HOST: z.string().default('127.0.0.1'),
    METRICS_PORT: z.coerce.number().int().default(9586),
    /** Simulate WireGuard (no root / kernel module needed) – for development only. */
    AGENT_DRY_RUN: envBoolean(false),
    AGENT_AUTO_UPDATE: envBoolean(false),
    AGENT_UPDATE_COMMAND: z.string().default('/usr/local/lib/stormvpn-agent/update.sh'),
    AGENT_ALLOW_INSECURE_HTTP: envBoolean(false),
    HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),
    TOKEN_ROTATION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.STORMVPN_API_URL.startsWith('http://') && !env.AGENT_ALLOW_INSECURE_HTTP) {
      ctx.addIssue({
        code: 'custom',
        path: ['STORMVPN_API_URL'],
        message:
          'must use https:// (set AGENT_ALLOW_INSECURE_HTTP=true for local development only)',
      });
    }
  });
export type AgentConfig = z.infer<typeof agentEnvSchema>;

export function loadAgentConfig(
  source: Record<string, string | undefined> = process.env,
): AgentConfig {
  return loadEnv(agentEnvSchema, source);
}
