import { generatePresharedKey, generateWireGuardKeyPair } from '@stormvpn/crypto';
import type { DataEncryptor } from '@stormvpn/crypto/node';
import { ADMIN_DISABLE_REASON, bumpPeerRevision } from '@stormvpn/core';
import { type Database, isUniqueViolation, type VPNPeer, type VPNServer } from '@stormvpn/database';
import { conflict, forbidden, notFound, serviceUnavailable } from '../../lib/errors';
import { allocateIpv4, hostIndex, ipv6ForHost } from './ip-allocator';

const MAX_ALLOCATION_ATTEMPTS = 5;

export interface ProvisionPeerInput {
  userId: string;
  deviceId: string;
  server: VPNServer;
  /** Client supplied public key; when absent a key pair is generated and the private key returned once. */
  publicKey?: string;
}

export interface ProvisionedPeer {
  peer: VPNPeer;
  presharedKey: string;
  /** Only set when the server generated the key pair. Never persisted. */
  privateKey?: string;
  created: boolean;
}

/** Associated data binds an encrypted PSK to its peer so ciphertexts cannot be swapped between rows. */
const pskAad = (serverId: string, publicKey: string) => `psk:${serverId}:${publicKey}`;

/**
 * WireGuard peer lifecycle on StormVPN's own nodes: IP allocation, key and
 * pre-shared key management, and desired-state revision bumps that trigger
 * node synchronisation.
 */
export class PeerService {
  constructor(
    private readonly db: Database,
    private readonly encryptor: DataEncryptor,
  ) {}

  decryptPresharedKey(peer: Pick<VPNPeer, 'serverId' | 'publicKey' | 'presharedKeyEnc'>): string | null {
    if (!peer.presharedKeyEnc) return null;
    return this.encryptor.decrypt(peer.presharedKeyEnc, pskAad(peer.serverId, peer.publicKey));
  }

  async provision(input: ProvisionPeerInput): Promise<ProvisionedPeer> {
    const generated = input.publicKey ? undefined : generateWireGuardKeyPair();
    const publicKey = input.publicKey ?? generated!.publicKey;
    const existing = await this.db.vPNPeer.findUnique({
      where: { deviceId_serverId: { deviceId: input.deviceId, serverId: input.server.id } },
    });

    if (existing) {
      if (existing.status === 'DISABLED' && existing.disabledReason === ADMIN_DISABLE_REASON) {
        throw forbidden('peer_disabled', 'This configuration was disabled by an administrator');
      }
      if (existing.publicKey === publicKey && existing.status === 'ACTIVE') {
        return { peer: existing, presharedKey: this.decryptPresharedKey(existing)!, created: false };
      }
      return this.rekey(existing, publicKey, generated?.privateKey);
    }
    return this.create(input, publicKey, generated?.privateKey);
  }

  private async rekey(existing: VPNPeer, publicKey: string, privateKey?: string): Promise<ProvisionedPeer> {
    const presharedKey = generatePresharedKey();
    try {
      const peer = await this.db.$transaction(async (tx) => {
        const updated = await tx.vPNPeer.update({
          where: { id: existing.id },
          data: {
            publicKey,
            presharedKeyEnc: this.encryptor.encrypt(presharedKey, pskAad(existing.serverId, publicKey)),
            status: 'ACTIVE',
            disabledReason: null,
            lastHandshakeAt: null,
          },
        });
        await bumpPeerRevision(tx, [existing.serverId]);
        return updated;
      });
      return { peer, presharedKey, privateKey, created: false };
    } catch (error) {
      if (isUniqueViolation(error, 'publicKey')) throw conflict('public_key_in_use', 'This public key is already registered');
      throw error;
    }
  }

  private async create(input: ProvisionPeerInput, publicKey: string, privateKey?: string): Promise<ProvisionedPeer> {
    const { server } = input;
    const presharedKey = generatePresharedKey();
    const presharedKeyEnc = this.encryptor.encrypt(presharedKey, pskAad(server.id, publicKey));

    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
      const used = await this.db.vPNPeer.findMany({ where: { serverId: server.id }, select: { ipv4Address: true } });
      const ipv4Address = allocateIpv4(server.wgSubnetV4, used.map((row) => row.ipv4Address));
      if (!ipv4Address) throw serviceUnavailable('server_address_pool_exhausted', `${server.name} has no free addresses`);
      const ipv6Address = server.wgSubnetV6 ? ipv6ForHost(server.wgSubnetV6, hostIndex(ipv4Address, server.wgSubnetV4)) : null;
      try {
        const peer = await this.db.$transaction(async (tx) => {
          const created = await tx.vPNPeer.create({
            data: {
              userId: input.userId,
              deviceId: input.deviceId,
              serverId: server.id,
              publicKey,
              presharedKeyEnc,
              ipv4Address,
              ipv6Address,
            },
          });
          await bumpPeerRevision(tx, [server.id]);
          return created;
        });
        return { peer, presharedKey, privateKey, created: true };
      } catch (error) {
        if (isUniqueViolation(error, 'publicKey')) throw conflict('public_key_in_use', 'This public key is already registered');
        if (isUniqueViolation(error, 'deviceId')) {
          // A concurrent request created the peer for this device – use it.
          return this.provision(input);
        }
        if (isUniqueViolation(error, 'ipv4Address')) continue; // lost an allocation race – retry
        throw error;
      }
    }
    throw serviceUnavailable('address_allocation_failed', 'Could not allocate an address, please retry');
  }

  async revoke(peerId: string, userId?: string): Promise<void> {
    const peer = await this.db.vPNPeer.findFirst({ where: { id: peerId, ...(userId ? { userId } : {}) } });
    if (!peer) throw notFound('Peer');
    await this.db.$transaction(async (tx) => {
      await tx.vPNConnection.updateMany({
        where: { peerId, status: { in: ['CONNECTING', 'CONNECTED'] } },
        data: { status: 'DISCONNECTED', endedAt: new Date(), disconnectReason: 'peer_revoked' },
      });
      await tx.vPNPeer.delete({ where: { id: peerId } });
      await bumpPeerRevision(tx, [peer.serverId]);
    });
  }

  async setDisabled(peerId: string, disabled: boolean): Promise<VPNPeer> {
    const peer = await this.db.vPNPeer.findUnique({ where: { id: peerId } });
    if (!peer) throw notFound('Peer');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.vPNPeer.update({
        where: { id: peerId },
        data: disabled ? { status: 'DISABLED', disabledReason: ADMIN_DISABLE_REASON } : { status: 'ACTIVE', disabledReason: null },
      });
      await bumpPeerRevision(tx, [peer.serverId]);
      return updated;
    });
  }
}
