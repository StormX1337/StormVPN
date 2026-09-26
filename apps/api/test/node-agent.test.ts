import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import {
  call,
  createDevice,
  createHarness,
  createServer,
  grantPlan,
  type Harness,
  heartbeatBody,
  registerUser,
  seedPlans,
} from './helpers/harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

async function adminSession() {
  return registerUser(h, 'admin@example.com', { role: 'ADMIN' });
}

async function enroll() {
  await seedPlans(h);
  const admin = await adminSession();
  const { server } = await createServer(h, {
    name: 'NL-AMS-01',
    countryCode: 'NL',
    withNode: false,
    subnet: '10.95.0.0/20',
  });
  const token = await call(h, admin, {
    method: 'POST',
    url: `/api/v1/admin/servers/${server.id}/enrollment-token`,
  });
  expect(token.statusCode, token.body).toBe(200);
  return { admin, server, enrollmentToken: token.json().enrollmentToken as string };
}

const registerPayload = (enrollmentToken: string) => ({
  enrollmentToken,
  hostname: 'nl-ams-01.nodes.test',
  agentVersion: '1.0.0',
  wireguardPublicKey: generateWireGuardKeyPair().publicKey,
  publicIpv4: '198.51.100.7',
  os: 'Ubuntu 24.04',
});

describe('node registration', () => {
  it('registers with a single-use enrollment token and issues a node token', async () => {
    const { server, enrollmentToken } = await enroll();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/register',
      payload: registerPayload(enrollmentToken),
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.serverName).toBe('NL-AMS-01');
    expect(body.nodeToken).toMatch(/^snt_/);
    const node = await h.db.vPNNode.findUniqueOrThrow({ where: { serverId: server.id } });
    expect(node.tokenHash).not.toBe(body.nodeToken);
    expect(node.tokenHash).toHaveLength(64);

    const reuse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/register',
      payload: registerPayload(enrollmentToken),
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('rejects expired enrollment tokens and invalid node tokens', async () => {
    const { enrollmentToken } = await enroll();
    h.clock.advance(25 * 3600_000);
    const expired = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/register',
      payload: registerPayload(enrollmentToken),
    });
    expect(expired.statusCode).toBe(401);
    const heartbeat = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: { authorization: 'Bearer snt_invalid' },
      payload: heartbeatBody(),
    });
    expect(heartbeat.statusCode).toBe(401);
  });
});

describe('heartbeat & configuration sync', () => {
  it('updates metrics/status, samples history and returns the desired revision', async () => {
    const { server, enrollmentToken } = await enroll();
    const { nodeToken } = (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/agent/register',
        payload: registerPayload(enrollmentToken),
      })
    ).json();
    const auth = { authorization: `Bearer ${nodeToken}` };

    const beat = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: auth,
      payload: heartbeatBody(),
    });
    expect(beat.statusCode, beat.body).toBe(200);
    expect(beat.json()).toMatchObject({
      heartbeatIntervalSeconds: 15,
      maintenance: false,
      killSwitch: false,
    });
    const node = await h.db.vPNNode.findUniqueOrThrow({ where: { serverId: server.id } });
    expect(node.status).toBe('ONLINE');
    expect(node.cpuPercent).toBe(20);
    expect(await h.db.nodeHeartbeat.count()).toBe(1);

    await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: auth,
      payload: heartbeatBody(),
    });
    expect(await h.db.nodeHeartbeat.count()).toBe(1); // sampled at most once per minute

    const degraded = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: auth,
      payload: heartbeatBody({
        health: { nat: { ok: false, message: 'masquerade rule missing' } },
      }),
    });
    expect(degraded.statusCode).toBe(200);
    expect((await h.db.vPNNode.findUniqueOrThrow({ where: { serverId: server.id } })).status).toBe(
      'DEGRADED',
    );
    expect(h.events.adminEvents.some((event) => event.type === 'admin.node')).toBe(true);
  });

  it('serves the peer set with decrypted PSKs, supports ETags and honours the kill switch', async () => {
    const { admin, server, enrollmentToken } = await enroll();
    const { nodeToken } = (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/agent/register',
        payload: registerPayload(enrollmentToken),
      })
    ).json();
    const auth = { authorization: `Bearer ${nodeToken}` };
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: auth,
      payload: heartbeatBody(),
    });

    const plans = await h.db.plan.findUniqueOrThrow({ where: { slug: 'pro' } });
    const user = await registerUser(h, 'peer@example.com');
    await grantPlan(h, user.userId, plans.id);
    const device = await createDevice(h, user);
    const key = generateWireGuardKeyPair().publicKey;
    const configResponse = await call(h, user, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id, publicKey: key },
    });
    const psk = configResponse.json().config.match(/PresharedKey = (.+)/)[1];

    const config = await h.app.inject({
      method: 'GET',
      url: '/api/v1/agent/config',
      headers: auth,
    });
    expect(config.statusCode).toBe(200);
    const body = config.json();
    expect(body.interface).toMatchObject({
      listenPort: 51820,
      addressV4: '10.95.0.1/20',
      subnetV4: '10.95.0.0/20',
    });
    expect(body.peers).toEqual([
      { publicKey: key, presharedKey: psk, allowedIps: expect.arrayContaining(['10.95.0.2/32']) },
    ]);

    const cached = await h.app.inject({
      method: 'GET',
      url: '/api/v1/agent/config',
      headers: { ...auth, 'if-none-match': config.headers.etag as string },
    });
    expect(cached.statusCode).toBe(304);

    const kill = await call(h, admin, {
      method: 'POST',
      url: `/api/v1/admin/servers/${server.id}/kill-switch`,
      payload: { engaged: true, reason: 'abuse investigation' },
    });
    expect(kill.statusCode, kill.body).toBe(200);
    const afterKill = await h.app.inject({
      method: 'GET',
      url: '/api/v1/agent/config',
      headers: auth,
    });
    expect(afterKill.json().peers).toEqual([]);
    const beat = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: auth,
      payload: heartbeatBody(),
    });
    expect(beat.json().killSwitch).toBe(true);
  });

  it('excludes peers of suspended users', async () => {
    const { admin, server, enrollmentToken } = await enroll();
    const { nodeToken } = (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/agent/register',
        payload: registerPayload(enrollmentToken),
      })
    ).json();
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: { authorization: `Bearer ${nodeToken}` },
      payload: heartbeatBody(),
    });
    const user = await registerUser(h, 'bad@example.com');
    const device = await createDevice(h, user);
    const provisioned = await call(h, user, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: {
        deviceId: device.id,
        serverId: server.id,
        publicKey: generateWireGuardKeyPair().publicKey,
      },
    });
    expect(provisioned.statusCode, provisioned.body).toBe(200);
    const suspend = await call(h, admin, {
      method: 'POST',
      url: `/api/v1/admin/users/${user.userId}/suspend`,
      payload: { reason: 'Terms of service violation' },
    });
    expect(suspend.statusCode).toBe(204);
    const config = await h.app.inject({
      method: 'GET',
      url: '/api/v1/agent/config',
      headers: { authorization: `Bearer ${nodeToken}` },
    });
    expect(config.json().peers).toEqual([]);
    const peer = await h.db.vPNPeer.findFirstOrThrow();
    expect(peer).toMatchObject({ status: 'DISABLED', disabledReason: 'SUSPENDED' });
    // The suspended user's session is revoked immediately.
    expect((await call(h, user, { method: 'GET', url: '/api/v1/user' })).statusCode).toBe(401);
  });
});
