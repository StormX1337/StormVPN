import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateWireGuardKeyPair, deriveWireGuardPublicKey, PRIVATE_KEY_PLACEHOLDER } from '@stormvpn/crypto';
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
let plans: Awaited<ReturnType<typeof seedPlans>>;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  plans = await seedPlans(h);
});

async function proUser(email = 'vpn@example.com') {
  const session = await registerUser(h, email);
  await grantPlan(h, session.userId, plans.pro.id);
  return session;
}

describe('devices', () => {
  it('enforces the plan device limit', async () => {
    const session = await registerUser(h, 'devices@example.com'); // free plan: 1 device
    await createDevice(h, session, 'Phone');
    const second = await call(h, session, { method: 'POST', url: '/api/v1/devices', payload: { name: 'Tablet', platform: 'IOS' } });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('device_limit_reached');
    const list = await call(h, session, { method: 'GET', url: '/api/v1/devices' });
    expect(list.json()).toHaveLength(1);
  });
});

describe('WireGuard peer creation', () => {
  it('registers a client key without the server ever seeing the private key', async () => {
    const session = await proUser();
    const { server } = await createServer(h, { name: 'DE-FRA-01', subnet: '10.90.0.0/20' });
    const device = await createDevice(h, session);
    const keys = generateWireGuardKeyPair();

    const response = await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id, publicKey: keys.publicKey },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.privateKeyIncluded).toBe(false);
    expect(body.config).toContain(`PrivateKey = ${PRIVATE_KEY_PLACEHOLDER}`);
    expect(body.config).toContain('Address = 10.90.0.2/32');
    expect(body.config).toContain('DNS = 10.90.0.1');
    expect(body.config).toContain('Endpoint = 203.0.113.');
    expect(body.config).toContain('PersistentKeepalive = 25');
    expect(body.config).toMatch(/PresharedKey = [A-Za-z0-9+/]{43}=/);

    const peer = await h.db.vPNPeer.findFirstOrThrow({ where: { deviceId: device.id } });
    expect(peer.publicKey).toBe(keys.publicKey);
    expect(peer.presharedKeyEnc).not.toContain(body.config.match(/PresharedKey = (.+)/)![1]);
    const revision = await h.db.vPNServer.findUniqueOrThrow({ where: { id: server.id } });
    expect(revision.peerRevision).toBe(2);
  });

  it('generates a key pair server-side when requested and returns the private key once', async () => {
    const session = await proUser();
    const { server } = await createServer(h);
    const device = await createDevice(h, session);
    const response = await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id },
    });
    const body = response.json();
    expect(body.privateKeyIncluded).toBe(true);
    const privateKey = body.config.match(/PrivateKey = (.+)/)[1];
    const peer = await h.db.vPNPeer.findFirstOrThrow({ where: { deviceId: device.id } });
    expect(deriveWireGuardPublicKey(privateKey)).toBe(peer.publicKey);
    // No column contains the private key.
    expect(JSON.stringify(peer, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain(privateKey);
  });

  it('allocates unique addresses per server and reuses the peer for the same key', async () => {
    const session = await proUser();
    const { server } = await createServer(h, { subnet: '10.91.0.0/20' });
    const laptop = await createDevice(h, session, 'Laptop');
    const phone = await createDevice(h, session, 'Phone');
    const key = generateWireGuardKeyPair().publicKey;
    const configFor = (deviceId: string, publicKey: string) =>
      call(h, session, { method: 'POST', url: '/api/v1/wireguard/config', payload: { deviceId, serverId: server.id, publicKey } });

    expect((await configFor(laptop.id, key)).json().peer.ipv4Address).toBe('10.91.0.2');
    expect((await configFor(phone.id, generateWireGuardKeyPair().publicKey)).json().peer.ipv4Address).toBe('10.91.0.3');
    const again = (await configFor(laptop.id, key)).json();
    expect(again.peer.ipv4Address).toBe('10.91.0.2');
    expect(await h.db.vPNPeer.count()).toBe(2);

    const conflict = await configFor(phone.id, key);
    expect(conflict.statusCode).toBe(409);
  });

  it('rejects servers outside the plan', async () => {
    const session = await registerUser(h, 'free@example.com');
    const { server } = await createServer(h, { name: 'US-NYC-01', countryCode: 'US', city: 'New York' });
    const device = await createDevice(h, session);
    const response = await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id, publicKey: generateWireGuardKeyPair().publicKey },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('server_not_in_plan');
  });

  it('requires a verified email', async () => {
    const session = await registerUser(h, 'unverified@example.com', { verify: false });
    const response = await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: '0190a5b4-0000-7000-8000-000000000001' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('email_not_verified');
  });
});

describe('server selection (Quick Connect)', () => {
  it('picks the least loaded eligible server and skips overloaded nodes', async () => {
    const session = await proUser();
    await createServer(h, { name: 'DE-FRA-01', load: 92, activeConnections: 460 });
    const { server: best } = await createServer(h, { name: 'DE-FRA-02', load: 31, activeConnections: 155 });
    await createServer(h, { name: 'DE-FRA-03', load: 45, activeConnections: 225 });
    const recommended = await call(h, session, { method: 'GET', url: '/api/v1/servers/recommended' });
    expect(recommended.statusCode, recommended.body).toBe(200);
    expect(recommended.json().server.id).toBe(best.id);

    const device = await createDevice(h, session);
    const connect = await call(h, session, {
      method: 'POST',
      url: '/api/v1/connections',
      payload: { deviceId: device.id, publicKey: generateWireGuardKeyPair().publicKey },
    });
    expect(connect.statusCode, connect.body).toBe(201);
    expect(connect.json().connection.server.name).toBe('DE-FRA-02');
    expect(connect.json().selection.strategy).toBe('quick');
  });

  it('lists servers with plan availability and offline state', async () => {
    const session = await registerUser(h, 'list@example.com');
    await createServer(h, { name: 'DE-FRA-01' });
    await createServer(h, { name: 'US-NYC-01', countryCode: 'US', city: 'New York' });
    await createServer(h, { name: 'NL-AMS-01', countryCode: 'NL', city: 'Amsterdam', withNode: false });
    const response = await call(h, session, { method: 'GET', url: '/api/v1/servers' });
    const servers = response.json() as { name: string; allowed: boolean; status: string }[];
    expect(servers.find((s) => s.name === 'DE-FRA-01')).toMatchObject({ allowed: true, status: 'ONLINE' });
    expect(servers.find((s) => s.name === 'US-NYC-01')).toMatchObject({ allowed: false });
    expect(servers.find((s) => s.name === 'NL-AMS-01')).toMatchObject({ status: 'OFFLINE' });
  });

  it('returns 503 when no server is available', async () => {
    const session = await proUser();
    await createServer(h, { load: 99 });
    const response = await call(h, session, { method: 'GET', url: '/api/v1/servers/recommended' });
    expect(response.statusCode).toBe(503);
  });
});

describe('connection lifecycle', () => {
  it('goes CONNECTING → CONNECTED (node handshake) → DISCONNECTED with traffic accounting', async () => {
    const session = await proUser();
    const { server, nodeToken } = await createServer(h);
    const device = await createDevice(h, session);
    const keys = generateWireGuardKeyPair();
    const connect = await call(h, session, {
      method: 'POST',
      url: '/api/v1/connections',
      payload: { deviceId: device.id, serverId: server.id, publicKey: keys.publicKey },
    });
    expect(connect.statusCode, connect.body).toBe(201);
    const connectionId = connect.json().connection.id as string;
    expect(connect.json().connection.status).toBe('CONNECTING');

    const heartbeat = await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: { authorization: `Bearer ${nodeToken}` },
      payload: heartbeatBody({
        peers: [
          { publicKey: keys.publicKey, latestHandshake: Math.floor(Date.now() / 1000) - 5, rxBytesDelta: 5_000, txBytesDelta: 90_000 },
        ],
      }),
    });
    expect(heartbeat.statusCode, heartbeat.body).toBe(200);

    const status = await call(h, session, { method: 'GET', url: '/api/v1/connections/status' });
    expect(status.json().connected).toBe(true);
    expect(status.json().connection.id).toBe(connectionId);
    expect(status.json().connection.rxBytes).toBe(5_000);
    expect(status.json().publicIp).toBe(server.publicIpv4);
    expect(h.events.userEvents.some((event) => event.message.type === 'connection.updated')).toBe(true);

    const traffic = await call(h, session, { method: 'GET', url: '/api/v1/traffic/summary?days=7' });
    expect(traffic.json().rxBytes + traffic.json().txBytes).toBe(95_000);

    const disconnect = await call(h, session, { method: 'DELETE', url: `/api/v1/connections/${connectionId}` });
    expect(disconnect.json().status).toBe('DISCONNECTED');
    expect(disconnect.json().disconnectReason).toBe('user');
  });

  it('enforces the simultaneous connection limit', async () => {
    const session = await proUser(); // pro: 2 sessions
    const { server } = await createServer(h);
    const devices = [await createDevice(h, session, 'A'), await createDevice(h, session, 'B'), await createDevice(h, session, 'C')];
    const connect = (deviceId: string) =>
      call(h, session, {
        method: 'POST',
        url: '/api/v1/connections',
        payload: { deviceId, serverId: server.id, publicKey: generateWireGuardKeyPair().publicKey },
      });
    expect((await connect(devices[0]!.id)).statusCode).toBe(201);
    expect((await connect(devices[1]!.id)).statusCode).toBe(201);
    const third = await connect(devices[2]!.id);
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe('connection_limit_reached');
    // Reconnecting an already connected device replaces its session instead of counting twice.
    expect((await connect(devices[0]!.id)).statusCode).toBe(201);
  });

  it('records config-file tunnels as CONFIG connections', async () => {
    const session = await proUser();
    const { server, nodeToken } = await createServer(h);
    const device = await createDevice(h, session);
    const keys = generateWireGuardKeyPair();
    await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id, publicKey: keys.publicKey },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/agent/heartbeat',
      headers: { authorization: `Bearer ${nodeToken}` },
      payload: heartbeatBody({
        peers: [{ publicKey: keys.publicKey, latestHandshake: Math.floor(Date.now() / 1000), rxBytesDelta: 1, txBytesDelta: 1 }],
      }),
    });
    const connection = await h.db.vPNConnection.findFirstOrThrow({ where: { userId: session.userId } });
    expect(connection.source).toBe('CONFIG');
    expect(connection.status).toBe('CONNECTED');
  });

  it('removing a device revokes its peers and bumps the node revision', async () => {
    const session = await proUser();
    const { server } = await createServer(h);
    const device = await createDevice(h, session);
    await call(h, session, {
      method: 'POST',
      url: '/api/v1/wireguard/config',
      payload: { deviceId: device.id, serverId: server.id, publicKey: generateWireGuardKeyPair().publicKey },
    });
    const before = (await h.db.vPNServer.findUniqueOrThrow({ where: { id: server.id } })).peerRevision;
    const response = await call(h, session, { method: 'DELETE', url: `/api/v1/devices/${device.id}` });
    expect(response.statusCode).toBe(204);
    expect(await h.db.vPNPeer.count()).toBe(0);
    expect((await h.db.vPNServer.findUniqueOrThrow({ where: { id: server.id } })).peerRevision).toBe(before + 1);
  });

  it('blocks new connections in maintenance mode', async () => {
    const session = await proUser();
    const { server } = await createServer(h);
    const device = await createDevice(h, session);
    await h.app.services.settings.update({ maintenanceMode: true, maintenanceMessage: 'Upgrading' }, null);
    const response = await call(h, session, {
      method: 'POST',
      url: '/api/v1/connections',
      payload: { deviceId: device.id, serverId: server.id, publicKey: generateWireGuardKeyPair().publicKey },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toBe('Upgrading');
  });
});
