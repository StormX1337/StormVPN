import type { ProviderType, VpnProtocol } from '@stormvpn/database';
import type { WireGuardConfigDto } from '@stormvpn/types';
import type { ServerWithNode } from '../servers/server-catalog';

export interface ProvisionRequest {
  userId: string;
  deviceId: string;
  server: ServerWithNode;
  publicKey?: string;
  allowedIps?: string[];
}

export interface ProvisionResult {
  peerId: string | null;
  assignedIpv4: string | null;
  wireguard: WireGuardConfigDto;
}

/**
 * Abstraction over VPN capacity providers. StormVPN's own WireGuard fleet is
 * the default; additional providers (other protocols, contractual partner
 * networks) plug in here without touching connection or billing logic.
 */
export interface VPNProvider {
  readonly type: ProviderType;
  readonly displayName: string;
  supports(protocol: VpnProtocol): boolean;
  isConfigured(): boolean;
  provision(request: ProvisionRequest): Promise<ProvisionResult>;
  revokePeer(peerId: string): Promise<void>;
}
