import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import {
  DEFAULT_JOB_CONFIG,
  type JobContext,
  runAbuseScan,
  runConnectionReaper,
  runNodeHealth,
  runSubscriptionLifecycle,
  runTrafficEnforcement,
  SettingsService,
} from '@stormvpn/core';
import { createLogger } from '@stormvpn/config';
import { call, createDevice, createHarness, createServer, type Harness, registerUser, seedPlans } from './helpers/harness';

let h: Harness;
let ctx: JobContext;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await seedPlans(h);
  ctx = {
    db: h.db,
    settings: new SettingsService(h.db, 0),
    logger: createLogger({ name: 'jobs-test', level: 'silent' }),
    config: DEFAULT_JOB_CONFIG,
    mail: h.mail,
    events: h.events,
  };
});

describe('maintenance jobs', () => {
  it('marks nodes without heartbeats offline', async () => {
    const { server } = await createServer(h);
    await h.db.vPNNode.update({ where: { serverId: server.id }, data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    const result = await runNodeHealth(ctx);
    expect(result.markedOffline).toBe(1);
    expect((await h.db.vPNNode.findUniqueOrThrow({ where: { serverId: server.id } })).status).toBe('OFFLINE');
  });

  it('reaps stale connections', async () => {
    const session = await registerUser(h, 'reaper@example.com');
    const { server } = await createServer(h);
    await h.db.vPNConnection.createMany({
      data: [
        { userId: session.userId, serverId: server.id, status: 'CONNECTED', lastHandshakeAt: new Date(Date.now() - 20 * 60_000) },
        { userId: session.userId, serverId: server.id, status: 'CONNECTING', startedAt: new Date(Date.now() - 20 * 60_000) },
        { userId: session.userId, serverId: server.id, status: 'CONNECTED', lastHandshakeAt: new Date() },
      ],
    });
    const result = await runConnectionReaper(ctx);
    expect(result).toEqual({ closed: 1, failed: 1 });
    expect(await h.db.vPNConnection.count({ where: { status: 'CONNECTED' } })).toBe(1);
  });

  it('disables peers when the traffic allowance is exhausted and restores them after an upgrade', async () => {
    const session = await registerUser(h, 'traffic@example.com'); // free: 10 GiB
    const { server } = await createServer(h);
    const device = await createDevice(h, session);
    await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id, publicKey: generateWireGuardKeyPair().publicKey },
    });
    await h.db.trafficUsage.create({
      data: { userId: session.userId, serverId: server.id, day: new Date(), rxBytes: BigInt(6 * 1024 ** 3), txBytes: BigInt(5 * 1024 ** 3) },
    });
    expect((await runTrafficEnforcement(ctx)).limited).toBe(1);
    expect(await h.db.vPNPeer.findFirstOrThrow()).toMatchObject({ status: 'DISABLED', disabledReason: 'TRAFFIC_LIMIT' });
    expect(h.mail.last('traffic-limit-reached')).toBeDefined();

    const blocked = await call(h, session, {
      method: 'POST',
      url: '/api/v1/connections',
      payload: { deviceId: device.id, serverId: server.id, publicKey: generateWireGuardKeyPair().publicKey },
    });
    expect(blocked.statusCode).toBe(402);

    const pro = await h.db.plan.findUniqueOrThrow({ where: { slug: 'pro' } });
    await h.db.subscription.updateMany({ where: { userId: session.userId }, data: { status: 'CANCELED' } });
    await h.db.subscription.create({ data: { userId: session.userId, planId: pro.id, status: 'ACTIVE' } });
    expect((await runTrafficEnforcement(ctx)).restored).toBe(1);
    expect((await h.db.vPNPeer.findFirstOrThrow()).status).toBe('ACTIVE');
  });

  it('expires complimentary subscriptions back to the free plan', async () => {
    const session = await registerUser(h, 'expire@example.com');
    const pro = await h.db.plan.findUniqueOrThrow({ where: { slug: 'pro' } });
    await h.db.subscription.updateMany({ where: { userId: session.userId }, data: { status: 'CANCELED' } });
    await h.db.subscription.create({
      data: { userId: session.userId, planId: pro.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    const result = await runSubscriptionLifecycle(ctx);
    expect(result.expired).toBe(1);
    const live = await h.db.subscription.findFirstOrThrow({ where: { userId: session.userId, status: 'ACTIVE' }, include: { plan: true } });
    expect(live.plan.slug).toBe('free');
  });

  it('automatically suspends accounts with a high risk score', async () => {
    const session = await registerUser(h, 'abuser@example.com');
    await h.db.securityEvent.createMany({
      data: Array.from({ length: 5 }, () => ({ userId: session.userId, type: 'REFRESH_TOKEN_REUSE', severity: 'HIGH' as const })),
    });
    const result = await runAbuseScan(ctx);
    expect(result.suspended).toBe(1);
    const user = await h.db.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(user).toMatchObject({ status: 'SUSPENDED', riskScore: 100 });
    expect(await h.db.auditLog.count({ where: { action: 'user.suspend', actorType: 'SYSTEM' } })).toBe(1);
  });
});
