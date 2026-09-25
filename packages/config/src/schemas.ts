import { z } from 'zod';
import { envBoolean, envList, envSecret } from './env';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');
const base64Key32 = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'must be 32 bytes encoded as base64 (openssl rand -base64 32)',
  });

const sharedInfra = {
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  LOG_PRETTY: envBoolean(false),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
};

/** Environment of the StormVPN REST/WebSocket API (apps/api). */
export const apiEnvSchema = z
  .object({
    ...sharedInfra,
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    TRUST_PROXY: z
      .string()
      .default('loopback')
      .describe('Fastify trustProxy: "true", "false", hop count or comma separated CIDRs'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    ADMIN_URL: z.string().url().default('http://localhost:3000/admin'),
    CORS_ORIGINS: envList(['http://localhost:3000', 'http://localhost:3001']),

    JWT_ACCESS_SECRET: envSecret(32),
    JWT_ISSUER: z.string().default('stormvpn-api'),
    JWT_AUDIENCE: z.string().default('stormvpn'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    COOKIE_SECURE: envBoolean(true),
    COOKIE_DOMAIN: z.string().optional(),

    DATA_ENCRYPTION_KEY: base64Key32,
    DATA_ENCRYPTION_KEY_PREVIOUS: base64Key32.optional(),

    STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

    METRICS_TOKEN: z.string().min(16).optional(),

    RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    REGISTRATION_ENABLED: envBoolean(true),
    REGISTRATIONS_PER_IP_PER_DAY: z.coerce.number().int().min(1).default(5),
    REQUIRE_EMAIL_VERIFICATION: envBoolean(true),

    NODE_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(15),
    NODE_OFFLINE_AFTER_SECONDS: z.coerce.number().int().min(15).default(90),
    NODE_ENROLLMENT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    AGENT_LATEST_VERSION: z.string().optional(),
    AGENT_UPDATE_BASE_URL: z.string().url().optional(),

    WG_DEFAULT_KEEPALIVE: z.coerce.number().int().min(0).max(600).default(25),
    WG_DEFAULT_ALLOWED_IPS: envList(['0.0.0.0/0', '::/0']),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
      }
      if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_WEBHOOK_SECRET'],
          message: 'required when STRIPE_SECRET_KEY is set',
        });
      }
    }
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Environment of the background worker (services/worker). */
export const workerEnvSchema = z.object({
  ...sharedInfra,
  HEALTH_PORT: z.coerce.number().int().default(4100),
  APP_URL: z.string().url().default('http://localhost:3000'),
  MAIL_FROM: z.string().default('StormVPN <no-reply@stormvpn.local>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: envBoolean(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
  NODE_OFFLINE_AFTER_SECONDS: z.coerce.number().int().min(15).default(90),
  CONNECTION_STALE_AFTER_SECONDS: z.coerce.number().int().min(60).default(300),
  HEARTBEAT_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
  ABUSE_AUTO_SUSPEND_SCORE: z.coerce.number().int().min(10).default(100),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Environment of the job scheduler (services/scheduler). */
export const schedulerEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  LOG_PRETTY: envBoolean(false),
  REDIS_URL: z.string().url(),
  HEALTH_PORT: z.coerce.number().int().default(4200),
});
export type SchedulerEnv = z.infer<typeof schedulerEnvSchema>;
