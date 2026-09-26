import { generatePrefixedToken, sha256Hex } from '@stormvpn/crypto/node';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import { getCountry } from '@stormvpn/types';
import type { PrismaClient, Region, ServerClass, VPNServer } from '../../generated/prisma/client';

interface DemoServer {
  name: string;
  city: string;
  publicIpv4: string;
  serverClass: ServerClass;
  lat: number;
  lon: number;
}

// Documentation address ranges (RFC 5737) – replace with real node IPs.
export const DEMO_SERVERS: DemoServer[] = [
  {
    name: 'DE-FRA-01',
    city: 'Frankfurt',
    publicIpv4: '203.0.113.11',
    serverClass: 'STANDARD',
    lat: 50.11,
    lon: 8.68,
  },
  {
    name: 'DE-FRA-02',
    city: 'Frankfurt',
    publicIpv4: '203.0.113.12',
    serverClass: 'STANDARD',
    lat: 50.11,
    lon: 8.68,
  },
  {
    name: 'DE-BER-01',
    city: 'Berlin',
    publicIpv4: '203.0.113.13',
    serverClass: 'PREMIUM',
    lat: 52.52,
    lon: 13.4,
  },
  {
    name: 'NL-AMS-01',
    city: 'Amsterdam',
    publicIpv4: '203.0.113.21',
    serverClass: 'STANDARD',
    lat: 52.37,
    lon: 4.9,
  },
  {
    name: 'FR-PAR-01',
    city: 'Paris',
    publicIpv4: '203.0.113.31',
    serverClass: 'STANDARD',
    lat: 48.86,
    lon: 2.35,
  },
  {
    name: 'UK-LON-01',
    city: 'London',
    publicIpv4: '203.0.113.41',
    serverClass: 'STREAMING',
    lat: 51.51,
    lon: -0.13,
  },
  {
    name: 'US-NYC-01',
    city: 'New York',
    publicIpv4: '198.51.100.11',
    serverClass: 'STANDARD',
    lat: 40.71,
    lon: -74.0,
  },
  {
    name: 'US-LAX-01',
    city: 'Los Angeles',
    publicIpv4: '198.51.100.21',
    serverClass: 'STREAMING',
    lat: 34.05,
    lon: -118.24,
  },
  {
    name: 'US-CHI-01',
    city: 'Chicago',
    publicIpv4: '198.51.100.31',
    serverClass: 'PREMIUM',
    lat: 41.88,
    lon: -87.63,
  },
];

/** Server names use UK for the United Kingdom, ISO 3166 uses GB. */
function countryFromName(name: string): string {
  const prefix = name.slice(0, 2);
  return prefix === 'UK' ? 'GB' : prefix;
}

export async function seedServers(prisma: PrismaClient) {
  const servers: VPNServer[] = [];
  for (const [index, demo] of DEMO_SERVERS.entries()) {
    const countryCode = countryFromName(demo.name);
    const region = (getCountry(countryCode)?.region ?? 'EUROPE') as Region;
    const data = {
      hostname: `${demo.name.toLowerCase()}.nodes.stormvpn.local`,
      countryCode,
      city: demo.city,
      region,
      latitude: demo.lat,
      longitude: demo.lon,
      publicIpv4: demo.publicIpv4,
      serverClass: demo.serverClass,
      capacity: 500,
      bandwidthCapacityMbps: 10_000,
      // Each server gets its own client subnet so peers never collide across the fleet.
      wgSubnetV4: `10.${80 + Math.floor(index / 16)}.${(index % 16) * 16}.0/20`,
      wgSubnetV6: `fd80:${(index + 1).toString(16)}::/64`,
      dnsServers: [],
    };
    servers.push(
      await prisma.vPNServer.upsert({
        where: { name: demo.name },
        create: { name: demo.name, ...data },
        update: data,
      }),
    );
  }

  // Demo nodes with simulated metrics for every server except DE-FRA-01 (kept for a real agent).
  const now = new Date();
  const demoNodes: { serverName: string; nodeToken: string }[] = [];
  for (const [index, server] of servers.entries()) {
    if (server.name === 'DE-FRA-01') continue;
    const nodeToken = generatePrefixedToken('snt');
    const load = [31, 45, 22, 58, 37, 18, 64, 27][index % 8]!;
    const nodeData = {
      tokenHash: sha256Hex(nodeToken),
      tokenPrefix: nodeToken.slice(0, 12),
      status: 'ONLINE' as const,
      agentVersion: '1.0.0',
      hostname: server.hostname,
      os: 'Ubuntu 24.04 LTS',
      kernel: '6.8.0-45-generic',
      wireguardPublicKey: generateWireGuardKeyPair().publicKey,
      publicIpv4: server.publicIpv4,
      cpuPercent: load * 0.7,
      memoryPercent: 30 + ((index * 7) % 40),
      memoryTotalBytes: BigInt(8 * 1024 ** 3),
      diskPercent: 12 + index * 3,
      rxBps: BigInt(load * 400_000),
      txBps: BigInt(load * 1_600_000),
      loadPercent: load,
      activeConnections: Math.round((load / 100) * server.capacity * 0.8),
      activePeers: Math.round((load / 100) * server.capacity),
      uptimeSeconds: BigInt(86_400 * (5 + index)),
      appliedPeerRevision: server.peerRevision,
      healthChecks: { wireguard: { ok: true }, ipForward: { ok: true }, nat: { ok: true } },
      lastHeartbeatAt: now,
    };
    await prisma.vPNNode.upsert({
      where: { serverId: server.id },
      create: { serverId: server.id, ...nodeData },
      update: nodeData,
    });
    demoNodes.push({ serverName: server.name, nodeToken });
  }

  // Enrollment token for DE-FRA-01 so a real agent can be registered in development.
  const enrollServer = servers.find((server) => server.name === 'DE-FRA-01')!;
  const enrollmentToken = generatePrefixedToken('sne');
  await prisma.vPNServer.update({
    where: { id: enrollServer.id },
    data: {
      enrollmentTokenHash: sha256Hex(enrollmentToken),
      enrollmentExpiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
    },
  });

  return {
    servers,
    demoNodes,
    enrollment: { serverName: enrollServer.name, token: enrollmentToken },
  };
}
