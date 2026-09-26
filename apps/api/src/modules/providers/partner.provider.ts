import type { VpnProtocol } from '@stormvpn/database';
import type { PeerDto } from '@stormvpn/types';
import { serviceUnavailable } from '../../lib/errors';
import { toServerSummary } from '../servers/server.mapper';
import type { ProvisionRequest, ProvisionResult, VPNProvider } from './vpn-provider';

/**
 * Contract for an officially documented partner/reseller API (e.g. a VPN
 * vendor's business or reseller program). Implementations MUST only use
 * endpoints and credentials issued under a written partner agreement –
 * never reverse-engineered, consumer-app or scraped interfaces.
 */
export interface PartnerApiClient {
  readonly partnerName: string;
  provisionWireGuardPeer(input: {
    externalUserRef: string;
    externalDeviceRef: string;
    location: { countryCode: string; city: string; partnerServerRef: string };
    publicKey: string;
  }): Promise<{
    config: string;
    peerRef: string;
    assignedIpv4: string;
    serverPublicKey: string;
  }>;
  revokePeer(peerRef: string): Promise<void>;
}

/**
 * Provider adapter for partner capacity. It stays disabled unless a
 * `PartnerApiClient` for an officially licensed API is supplied at composition
 * time; servers with provider=PARTNER then route here.
 */
export class PartnerProvider implements VPNProvider {
  readonly type = 'PARTNER' as const;

  constructor(private readonly client: PartnerApiClient | null = null) {}

  get displayName(): string {
    return this.client
      ? `Partner network (${this.client.partnerName})`
      : 'Partner network (not configured)';
  }

  supports(protocol: VpnProtocol): boolean {
    return protocol === 'WIREGUARD';
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    if (!this.client)
      throw serviceUnavailable('provider_not_configured', 'This location is not available');
    if (!request.publicKey) {
      throw serviceUnavailable(
        'client_key_required',
        'Partner locations require a client generated key',
      );
    }
    const result = await this.client.provisionWireGuardPeer({
      externalUserRef: request.userId,
      externalDeviceRef: request.deviceId,
      location: {
        countryCode: request.server.countryCode,
        city: request.server.city,
        partnerServerRef: request.server.hostname,
      },
      publicKey: request.publicKey,
    });
    const peer: PeerDto = {
      id: result.peerRef,
      serverId: request.server.id,
      serverName: request.server.name,
      publicKey: request.publicKey,
      ipv4Address: result.assignedIpv4,
      ipv6Address: null,
      status: 'ACTIVE',
      lastHandshakeAt: null,
      createdAt: new Date().toISOString(),
    };
    return {
      peerId: null,
      assignedIpv4: result.assignedIpv4,
      wireguard: {
        config: result.config,
        fileName: `stormvpn-${request.server.name.toLowerCase()}.conf`,
        privateKeyIncluded: false,
        peer,
        server: toServerSummary(request.server),
      },
    };
  }

  async revokePeer(peerRef: string): Promise<void> {
    if (!this.client)
      throw serviceUnavailable('provider_not_configured', 'Partner provider is not configured');
    await this.client.revokePeer(peerRef);
  }
}
