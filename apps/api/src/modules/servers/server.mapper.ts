import { countryName } from '@stormvpn/types';
import type { NodeStatus } from '@stormvpn/database';
import type { ServerDto, ServerSummaryDto } from '@stormvpn/types';
import type { ServerWithNode } from './server-catalog';

export function toServerSummary(server: {
  id: string;
  name: string;
  countryCode: string;
  city: string;
  publicIpv4: string;
}): ServerSummaryDto {
  return {
    id: server.id,
    name: server.name,
    countryCode: server.countryCode,
    countryName: countryName(server.countryCode),
    city: server.city,
    publicIpv4: server.publicIpv4,
  };
}

export function toServerDto(
  server: ServerWithNode,
  status: NodeStatus,
  options: { isFavorite: boolean; allowed: boolean },
): ServerDto {
  const active = status === 'OFFLINE' ? 0 : (server.node?.activeConnections ?? 0);
  return {
    ...toServerSummary(server),
    hostname: server.hostname,
    region: server.region,
    publicIpv6: server.publicIpv6,
    wireguardPort: server.wireguardPort,
    protocol: server.protocol,
    provider: server.provider,
    serverClass: server.serverClass,
    status,
    load: status === 'OFFLINE' ? 0 : (server.node?.loadPercent ?? 0),
    capacity: server.capacity,
    availableCapacity: Math.max(0, server.capacity - active),
    activeConnections: active,
    latitude: server.latitude,
    longitude: server.longitude,
    isFavorite: options.isFavorite,
    allowed: options.allowed,
  };
}
