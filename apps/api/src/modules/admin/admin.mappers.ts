import { toNumber, type VPNNode } from '@stormvpn/database';
import { countryName, type AdminNodeDto, type AdminServerDto } from '@stormvpn/types';
import type { ServerWithNode } from '../servers/server-catalog';

export function toAdminNodeDto(node: VPNNode, server: { name: string; peerRevision: number }): AdminNodeDto {
  const rx = toNumber(node.rxBps);
  const tx = toNumber(node.txBps);
  return {
    id: node.id,
    serverId: node.serverId,
    serverName: server.name,
    hostname: node.hostname,
    status: node.status,
    agentVersion: node.agentVersion,
    publicIpv4: node.publicIpv4,
    wireguardPublicKey: node.wireguardPublicKey,
    metrics: {
      cpuPercent: node.cpuPercent,
      memoryPercent: node.memoryPercent,
      diskPercent: node.diskPercent,
      rxBps: rx,
      txBps: tx,
      bandwidthMbps: Math.round(((Math.max(rx, tx) * 8) / 1_000_000) * 10) / 10,
      activeConnections: node.activeConnections,
      activePeers: node.activePeers,
      load: node.loadPercent,
      uptimeSeconds: toNumber(node.uptimeSeconds),
    },
    totalRxBytes: toNumber(node.totalRxBytes),
    totalTxBytes: toNumber(node.totalTxBytes),
    peerRevision: server.peerRevision,
    appliedPeerRevision: node.appliedPeerRevision,
    healthChecks: (node.healthChecks as AdminNodeDto['healthChecks']) ?? null,
    lastHeartbeatAt: node.lastHeartbeatAt?.toISOString() ?? null,
    registeredAt: node.registeredAt.toISOString(),
  };
}

export function toAdminServerDto(server: ServerWithNode, peerCount: number, nodeStatus: AdminServerDto['nodeStatus']): AdminServerDto {
  return {
    id: server.id,
    name: server.name,
    hostname: server.hostname,
    countryCode: server.countryCode,
    countryName: countryName(server.countryCode),
    city: server.city,
    region: server.region,
    latitude: server.latitude,
    longitude: server.longitude,
    publicIpv4: server.publicIpv4,
    publicIpv6: server.publicIpv6,
    privateIp: server.privateIp,
    wireguardPort: server.wireguardPort,
    protocol: server.protocol,
    provider: server.provider,
    serverClass: server.serverClass,
    status: server.status,
    nodeStatus,
    capacity: server.capacity,
    bandwidthCapacityMbps: server.bandwidthCapacityMbps,
    wgSubnetV4: server.wgSubnetV4,
    wgSubnetV6: server.wgSubnetV6,
    dnsServers: server.dnsServers,
    killSwitchEngaged: server.killSwitchEngaged,
    load: server.node?.loadPercent ?? 0,
    activeConnections: server.node?.activeConnections ?? 0,
    peerCount,
    nodeId: server.node?.id ?? null,
    lastHeartbeatAt: server.node?.lastHeartbeatAt?.toISOString() ?? null,
    createdAt: server.createdAt.toISOString(),
  };
}
