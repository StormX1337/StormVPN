import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createHarness, createServer, type Harness, registerUser, seedPlans } from './helpers/harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await seedPlans(h);
});

const serverPayload = {
  name: 'fr-par-01',
  hostname: 'fr-par-01.nodes.test',
  countryCode: 'fr',
  city: 'Paris',
  region: 'EUROPE',
  publicIpv4: '203.0.113.99',
  wgSubnetV4: '10.120.0.0/20',
};

describe('admin authorization', () => {
  it('denies regular users, allows support read-only and admins full access', async () => {
    const user = await registerUser(h, 'user@example.com');
    const support = await registerUser(h, 'support@example.com', { role: 'SUPPORT' });
    const admin = await registerUser(h, 'admin@example.com', { role: 'ADMIN' });

    expect((await call(h, null, { method: 'GET', url: '/api/v1/admin/stats' })).statusCode).toBe(401);
    expect((await call(h, user, { method: 'GET', url: '/api/v1/admin/stats' })).statusCode).toBe(403);
    expect((await call(h, user, { method: 'GET', url: '/api/v1/admin/users' })).statusCode).toBe(403);

    expect((await call(h, support, { method: 'GET', url: '/api/v1/admin/users' })).statusCode).toBe(200);
    const supportWrite = await call(h, support, { method: 'POST', url: '/api/v1/admin/servers', payload: serverPayload });
    expect(supportWrite.statusCode).toBe(403);
    expect(supportWrite.json().error.code).toBe('read_only');

    const created = await call(h, admin, { method: 'POST', url: '/api/v1/admin/servers', payload: serverPayload });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ name: 'FR-PAR-01', countryCode: 'FR', status: 'ACTIVE' });
  });

  it('takes role changes into account immediately', async () => {
    const admin = await registerUser(h, 'admin@example.com', { role: 'ADMIN' });
    const promoted = await registerUser(h, 'promoted@example.com');
    expect((await call(h, promoted, { method: 'GET', url: '/api/v1/admin/stats' })).statusCode).toBe(403);
    const change = await call(h, admin, { method: 'PATCH', url: `/api/v1/admin/users/${promoted.userId}/role`, payload: { role: 'ADMIN' } });
    expect(change.statusCode).toBe(204);
    expect((await call(h, promoted, { method: 'GET', url: '/api/v1/admin/stats' })).statusCode).toBe(200);
    const self = await call(h, admin, { method: 'PATCH', url: `/api/v1/admin/users/${admin.userId}/role`, payload: { role: 'USER' } });
    expect(self.statusCode).toBe(400);
  });
});

describe('admin operations', () => {
  it('suspends/unsuspends users with audit trail', async () => {
    const admin = await registerUser(h, 'admin@example.com', { role: 'ADMIN' });
    const user = await registerUser(h, 'target@example.com');
    await call(h, admin, { method: 'POST', url: `/api/v1/admin/users/${user.userId}/suspend`, payload: { reason: 'Fraud check' } });
    expect((await h.db.user.findUniqueOrThrow({ where: { id: user.userId } })).status).toBe('SUSPENDED');
    await call(h, admin, { method: 'POST', url: `/api/v1/admin/users/${user.userId}/unsuspend` });
    expect((await h.db.user.findUniqueOrThrow({ where: { id: user.userId } })).status).toBe('ACTIVE');
    const logs = await call(h, admin, { method: 'GET', url: '/api/v1/admin/logs?action=user.' });
    const actions = logs.json().items.map((item: { action: string }) => item.action);
    expect(actions).toEqual(expect.arrayContaining(['user.suspend', 'user.unsuspend']));
  });

  it('manages plans dynamically and syncs paid plans to Stripe', async () => {
    const admin = await registerUser(h, 'admin@example.com', { role: 'ADMIN' });
    const create = await call(h, admin, {
      method: 'POST',
      url: '/api/v1/admin/plans',
      payload: { slug: 'ultra', name: 'StormVPN Ultra', priceCents: 1499, sortOrder: 20, maxDevices: 10, maxSessions: 10, serverClasses: ['STANDARD', 'PREMIUM', 'STREAMING'] },
    });
    expect(create.statusCode, create.body).toBe(201);
    const plan = create.json();
    expect(plan.stripePriceId).toMatch(/^price_test_/);

    const update = await call(h, admin, { method: 'PATCH', url: `/api/v1/admin/plans/${plan.id}`, payload: { priceCents: 1599 } });
    expect(update.json().stripePriceId).not.toBe(plan.stripePriceId);
    expect(h.stripe.calls).toContain('archivePrice');

    const publicPlans = await h.app.inject({ method: 'GET', url: '/api/v1/plans' });
    expect(publicPlans.json().map((p: { slug: string }) => p.slug)).toEqual(['free', 'pro', 'ultra']);
  });

  it('creates coupons, rejects overlapping subnets and toggles maintenance mode', async () => {
    const admin = await registerUser(h, 'admin@example.com', { role: 'ADMIN' });
    const coupon = await call(h, admin, { method: 'POST', url: '/api/v1/admin/coupons', payload: { code: 'storm20', percentOff: 20 } });
    expect(coupon.statusCode, coupon.body).toBe(201);
    expect(coupon.json()).toMatchObject({ code: 'STORM20', percentOff: 20 });

    await createServer(h, { subnet: '10.120.0.0/16' });
    const overlap = await call(h, admin, { method: 'POST', url: '/api/v1/admin/servers', payload: serverPayload });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error.code).toBe('subnet_overlap');

    const settings = await call(h, admin, { method: 'PATCH', url: '/api/v1/admin/settings', payload: { maintenanceMode: true } });
    expect(settings.json().maintenanceMode).toBe(true);
    const stats = await call(h, admin, { method: 'GET', url: '/api/v1/admin/stats' });
    expect(stats.json()).toMatchObject({ maintenanceMode: true, totalUsers: 1 });
  });
});
