import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createLogger } from '@stormvpn/config';
import { createRedis } from '@stormvpn/core';
import { generatePrefixedToken, sha256Hex } from '@stormvpn/crypto/node';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import { createPrismaClient, type Database } from '@stormvpn/database';
import { buildApp } from '../../src/app';
import { loadApiEnv, type ApiEnv } from '../../src/env';
import type { Clock } from '../../src/lib/clock';
import { TEST_DATABASE_URL } from '../global-setup';
import { CapturingEventPublisher, CapturingMailQueue, FakeStripeGateway, TEST_WEBHOOK_SECRET } from './fakes';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
export const PASSWORD = 'correct horse battery staple';

export class MutableClock implements Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
  reset(): void {
    this.offsetMs = 0;
  }
}

export interface Harness {
  app: FastifyInstance;
  db: Database;
  env: ApiEnv;
  mail: CapturingMailQueue;
  events: CapturingEventPublisher;
  stripe: FakeStripeGateway;
  clock: MutableClock;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const env = loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    JWT_ACCESS_SECRET: 'test-jwt-secret-with-plenty-of-entropy-0123456789',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    COOKIE_SECURE: 'false',
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    RATE_LIMIT_MAX_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    REGISTRATIONS_PER_IP_PER_DAY: '1000',
    ...envOverrides,
  });
  const db = createPrismaClient({ url: env.DATABASE_URL, poolSize: 5 });
  const redis = createRedis(env.REDIS_URL);
  const redisSubscriber = createRedis(env.REDIS_URL);
  const mail = new CapturingMailQueue();
  const events = new CapturingEventPublisher();
  const stripe = new FakeStripeGateway();
  const clock = new MutableClock();
  const app = await buildApp(
    {
      env,
      db,
      redis,
      redisSubscriber,
      logger: createLogger({ name: 'test', level: 'silent' }),
      mail,
      events,
      stripe,
      clock,
      random: () => 0,
    },
    { collectBusinessMetrics: false, realtime: false },
  );
  await app.ready();

  return {
    app,
    db,
    env,
    mail,
    events,
    stripe,
    clock,
    async reset() {
      const tables = await db.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      const list = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
      // Table names come from the catalog, not user input.
      await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`); // eslint-disable-line no-restricted-syntax
      await redis.flushdb();
      mail.sent.length = 0;
      events.userEvents.length = 0;
      events.adminEvents.length = 0;
      stripe.subscriptions.clear();
      stripe.checkouts.length = 0;
      clock.reset();
      app.services.catalog.invalidate();
      app.services.settings.invalidate();
    },
    async close() {
      await app.close();
      await db.$disconnect();
      await redis.quit();
      await redisSubscriber.quit();
    },
  };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

export interface Session {
  token: string;
  userId: string;
}

export function authed(session: Session, options: InjectOptions): InjectOptions {
  return { ...options, headers: { ...(options.headers ?? {}), authorization: `Bearer ${session.token}` } };
}

export async function call(h: Harness, session: Session | null, options: InjectOptions): Promise<LightMyRequestResponse> {
  return h.app.inject(session ? authed(session, options) : options);
}

const native = { 'x-stormvpn-client': 'native' };

/** Registers + verifies a user through the public API (native client flow). */
export async function registerUser(
  h: Harness,
  email: string,
  options: { verify?: boolean; role?: 'USER' | 'SUPPORT' | 'ADMIN' } = {},
): Promise<Session & { refreshToken: string }> {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: native,
    payload: { email, password: PASSWORD, acceptTerms: true, name: 'Test User' },
  });
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  const body = response.json();
  if (options.verify !== false) {
    await h.db.user.update({ where: { id: body.user.id }, data: { emailVerifiedAt: new Date() } });
  }
  if (options.role && options.role !== 'USER') {
    await h.db.user.update({ where: { id: body.user.id }, data: { role: options.role } });
  }
  return { token: body.tokens.accessToken, refreshToken: body.tokens.refreshToken, userId: body.user.id };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export async function seedPlans(h: Harness) {
  const free = await h.db.plan.create({
    data: {
      slug: 'free',
      name: 'Free',
      priceCents: 0,
      maxDevices: 1,
      maxSessions: 1,
      trafficLimitBytes: BigInt(10 * 1024 ** 3),
      allowedCountries: ['DE', 'NL'],
      serverClasses: ['STANDARD'],
      sortOrder: 0,
    },
  });
  const pro = await h.db.plan.create({
    data: {
      slug: 'pro',
      name: 'Pro',
      priceCents: 899,
      trialDays: 7,
      maxDevices: 3,
      maxSessions: 2,
      serverClasses: ['STANDARD', 'PREMIUM'],
      priority: 50,
      sortOrder: 10,
      stripePriceId: 'price_pro_test',
      stripeProductId: 'prod_pro_test',
    },
  });
  return { free, pro };
}

export async function grantPlan(h: Harness, userId: string, planId: string): Promise<void> {
  await h.db.subscription.updateMany({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    data: { status: 'CANCELED', endedAt: new Date() },
  });
  await h.db.subscription.create({ data: { userId, planId, status: 'ACTIVE', provider: 'NONE' } });
}

let serverCounter = 0;

export async function createServer(
  h: Harness,
  overrides: Partial<{
    name: string;
    countryCode: string;
    city: string;
    serverClass: 'STANDARD' | 'PREMIUM' | 'STREAMING';
    load: number;
    activeConnections: number;
    capacity: number;
    withNode: boolean;
    subnet: string;
  }> = {},
) {
  serverCounter += 1;
  const name = overrides.name ?? `DE-FRA-${String(serverCounter).padStart(2, '0')}`;
  const server = await h.db.vPNServer.create({
    data: {
      name,
      hostname: `${name.toLowerCase()}.nodes.test`,
      countryCode: overrides.countryCode ?? 'DE',
      city: overrides.city ?? 'Frankfurt',
      region: overrides.countryCode === 'US' ? 'NORTH_AMERICA' : 'EUROPE',
      latitude: 50.11,
      longitude: 8.68,
      publicIpv4: `203.0.113.${serverCounter}`,
      serverClass: overrides.serverClass ?? 'STANDARD',
      capacity: overrides.capacity ?? 500,
      wgSubnetV4: overrides.subnet ?? `10.${80 + serverCounter}.0.0/20`,
      wgSubnetV6: `fd80:${serverCounter.toString(16)}::/64`,
    },
  });
  let nodeToken: string | null = null;
  if (overrides.withNode !== false) {
    nodeToken = generatePrefixedToken('snt');
    await h.db.vPNNode.create({
      data: {
        serverId: server.id,
        tokenHash: sha256Hex(nodeToken),
        tokenPrefix: nodeToken.slice(0, 12),
        status: 'ONLINE',
        hostname: server.hostname,
        wireguardPublicKey: generateWireGuardKeyPair().publicKey,
        loadPercent: overrides.load ?? 10,
        activeConnections: overrides.activeConnections ?? 0,
        lastHeartbeatAt: new Date(),
      },
    });
  }
  h.app.services.catalog.invalidate();
  return { server, nodeToken };
}

export async function createDevice(h: Harness, session: Session, name = 'Laptop') {
  const response = await call(h, session, {
    method: 'POST',
    url: '/api/v1/devices',
    payload: { name, platform: 'LINUX' },
  });
  if (response.statusCode !== 201) throw new Error(`device create failed: ${response.body}`);
  return response.json() as { id: string };
}

export function heartbeatBody(overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: '1.0.0',
    metrics: {
      cpuPercent: 20,
      memoryPercent: 30,
      memoryTotalBytes: 8 * 1024 ** 3,
      diskPercent: 40,
      rxBps: 1_000_000,
      txBps: 2_000_000,
      uptimeSeconds: 3600,
      loadAverage: [0.5, 0.4, 0.3],
    },
    wireguard: { interfaceUp: true, listenPort: 51820, peerCount: 0, appliedRevision: 1, totalRxBytes: 0, totalTxBytes: 0 },
    health: { wireguard: { ok: true }, ipForward: { ok: true } },
    peers: [],
    ...overrides,
  };
}
