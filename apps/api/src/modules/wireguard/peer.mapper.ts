import type { VPNPeer } from '@stormvpn/database';
import type { PeerDto } from '@stormvpn/types';

export function toPeerDto(peer: VPNPeer, serverName: string): PeerDto {
  return {
    id: peer.id,
    serverId: peer.serverId,
    serverName,
    publicKey: peer.publicKey,
    ipv4Address: peer.ipv4Address,
    ipv6Address: peer.ipv6Address,
    status: peer.status,
    lastHandshakeAt: peer.lastHandshakeAt?.toISOString() ?? null,
    createdAt: peer.createdAt.toISOString(),
  };
}
