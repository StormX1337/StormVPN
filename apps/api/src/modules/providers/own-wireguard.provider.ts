import type { SettingsService } from '@stormvpn/core';
import type { VpnProtocol } from '@stormvpn/database';
import type { ApiEnv } from '../../env';
import { serviceUnavailable } from '../../lib/errors';
import { toServerSummary } from '../servers/server.mapper';
import { buildClientConfig } from '../wireguard/config.builder';
import { toPeerDto } from '../wireguard/peer.mapper';
import type { PeerService } from '../wireguard/peer.service';
import type { ProvisionRequest, ProvisionResult, VPNProvider } from './vpn-provider';

/** Default provider: WireGuard peers on StormVPN operated nodes. */
export class OwnWireGuardProvider implements VPNProvider {
  readonly type = 'OWN_WIREGUARD' as const;
  readonly displayName = 'StormVPN WireGuard network';

  constructor(
    private readonly peers: PeerService,
    private readonly settings: SettingsService,
    private readonly env: Pick<ApiEnv, 'WG_DEFAULT_KEEPALIVE' | 'WG_DEFAULT_ALLOWED_IPS'>,
  ) {}

  supports(protocol: VpnProtocol): boolean {
    return protocol === 'WIREGUARD';
  }

  isConfigured(): boolean {
    return true;
  }

  async provision(request: ProvisionRequest): Promise<ProvisionResult> {
    const { server } = request;
    if (!server.node?.wireguardPublicKey) {
      throw serviceUnavailable('server_not_ready', `${server.name} has no registered node yet`);
    }
    const provisioned = await this.peers.provision({
      userId: request.userId,
      deviceId: request.deviceId,
      server,
      publicKey: request.publicKey,
    });
    const settings = await this.settings.get();
    const { config, fileName } = buildClientConfig({
      server,
      serverPublicKey: server.node.wireguardPublicKey,
      peer: provisioned.peer,
      presharedKey: provisioned.presharedKey,
      privateKey: provisioned.privateKey,
      allowedIps: request.allowedIps ?? this.env.WG_DEFAULT_ALLOWED_IPS,
      defaultDns: settings.defaultDns,
      keepalive: this.env.WG_DEFAULT_KEEPALIVE,
    });
    return {
      peerId: provisioned.peer.id,
      assignedIpv4: provisioned.peer.ipv4Address,
      wireguard: {
        config,
        fileName,
        privateKeyIncluded: provisioned.privateKey !== undefined,
        peer: toPeerDto(provisioned.peer, server.name),
        server: toServerSummary(server),
      },
    };
  }

  async revokePeer(peerId: string): Promise<void> {
    await this.peers.revoke(peerId);
  }
}
