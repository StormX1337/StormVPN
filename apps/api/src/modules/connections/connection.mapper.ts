import { toNumber, type VPNConnection } from '@stormvpn/database';
import type { ConnectionDto } from '@stormvpn/types';
import { toServerSummary } from '../servers/server.mapper';

export type ConnectionWithRelations = VPNConnection & {
  server: { id: string; name: string; countryCode: string; city: string; publicIpv4: string };
  device: { name: string } | null;
  peer: { ipv4Address: string } | null;
};

export const connectionInclude = {
  server: { select: { id: true, name: true, countryCode: true, city: true, publicIpv4: true } },
  device: { select: { name: true } },
  peer: { select: { ipv4Address: true } },
} as const;

export function toConnectionDto(connection: ConnectionWithRelations): ConnectionDto {
  return {
    id: connection.id,
    status: connection.status,
    source: connection.source,
    server: toServerSummary(connection.server),
    deviceId: connection.deviceId,
    deviceName: connection.device?.name ?? null,
    assignedIpv4: connection.peer?.ipv4Address ?? null,
    startedAt: connection.startedAt.toISOString(),
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    endedAt: connection.endedAt?.toISOString() ?? null,
    lastHandshakeAt: connection.lastHandshakeAt?.toISOString() ?? null,
    rxBytes: toNumber(connection.rxBytes),
    txBytes: toNumber(connection.txBytes),
    disconnectReason: connection.disconnectReason,
  };
}
