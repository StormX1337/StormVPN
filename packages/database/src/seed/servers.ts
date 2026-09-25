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
  { name: 'DE-FRA-01', city: 'Frankfurt', publicIpv4: '203.0.113.11', serverClass: 'STANDARD', lat: 50.11, lon: 8.68 },
  { name: 'DE-FRA-02', city: 'Frankfurt', publicIpv4: '203.0.113.12', serverClass: 'STANDARD', lat: 50.11, lon: 8.68 },
  { name: 'DE-BER-01', city: 'Berlin', publicIpv4: '203.0.113.13', serverClass: 'PREMIUM', lat: 52.52, lon: 13.4 },
  { name: 'NL-AMS-01', city: 'Amsterdam', publicIpv4: '203.0.113.21', serverClass: 'STANDARD', lat: 52.37, lon: 4.9 },
  { name: 'FR-PAR-01', city: 'Paris', publicIpv4: '203.0.113.31', serverClass: 'STANDARD', lat: 48.86, lon: 2.35 },
  { name: 'UK-LON-01', city: 'London', publicIpv4: '203.0.113.41', serverClass: 'STREAMING', lat: 51.51, lon: -0.13 },
  { name: 'US-NYC-01', city: 'New York', publicIpv4: '198.51.100.11', serverClass: 'STANDARD', lat: 40.71, lon: -74.0 },
  { name: 'US-LAX-01', city: 'Los Angeles', publicIpv4: '198.51.100.21', serverClass: 'STREAMING', lat: 34.05, lon: -118.24 },
  { name: 'US-CHI-01', city: 'Chicago', publicIpv4: '198.51.100.31', serverClass: 'PREMIUM', lat: 41.88, lon: -87.63 },
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

  // Demo node (simulated metrics) for DE-FRA-02 so dashboards have live data.
  const demoServer = servers.find((server) => server.name === 'DE-FRA-02')!;
  const nodeToken = generatePrefixedToken('snt');
  const now = new Date();
  const nodeData = {
    tokenHash: sha256Hex(nodeToken),
    tokenPrefix: nodeToken.slice(0, 12),
    status: 'ONLINE' as const,
    agentVersion: '1.0.0',
    hostname: demoServer.hostname,
    os: 'Ubuntu 24.04 LTS',
    kernel: '6.8.0-45-generic',
    wireguardPublicKey: generateWireGuardKeyPair().publicKey,
    publicIpv4: demoServer.publicIpv4,
    cpuPercent: 23.5,
    memoryPercent: 41.2,
    memoryTotalBytes: BigInt(8 * 1024 ** 3),
    diskPercent: 18.4,
    rxBps: BigInt(12_500_000),
    txBps: BigInt(48_200_000),
    loadPercent: 31,
    activeConnections: 0,
    activePeers: 0,
    uptimeSeconds: BigInt(86_400 * 12),
    appliedPeerRevision: demoServer.peerRevision,
    healthChecks: { wireguard: { ok: true }, ipForward: { ok: true }, nat: { ok: true } },
    lastHeartbeatAt: now,
  };
  await prisma.vPNNode.upsert({
    where: { serverId: demoServer.id },
    create: { serverId: demoServer.id, ...nodeData },
    update: nodeData,
  });

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
    demoNode: { serverName: demoServer.name, nodeToken },
    enrollment: { serverName: enrollServer.name, token: enrollmentToken },
  };
}
