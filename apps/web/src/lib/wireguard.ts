import { generateWireGuardKeyPair, injectPrivateKey } from '@stormvpn/crypto';
import type { ServerSummaryDto } from '@stormvpn/types';
import QRCode from 'qrcode';
import { api } from './api';

export interface GeneratedConfig {
  config: string;
  fileName: string;
  server: ServerSummaryDto;
  assignedIpv4: string;
  connectionId: string | null;
  selectionReason: string;
}

export interface ProvisionTarget {
  deviceId: string;
  serverId?: string;
  country?: string;
}

/**
 * The key pair is generated in the browser; only the public key is sent to
 * StormVPN. The private key exists solely in this page's memory and in the
 * config the user downloads or scans.
 */
export async function provisionConfig(
  target: ProvisionTarget,
  mode: 'connect' | 'config',
): Promise<GeneratedConfig> {
  const keys = generateWireGuardKeyPair();
  const input = { ...target, publicKey: keys.publicKey };
  if (mode === 'connect') {
    const result = await api.connections.connect(input);
    return {
      config: injectPrivateKey(result.wireguard.config, keys.privateKey),
      fileName: result.wireguard.fileName,
      server: result.wireguard.server,
      assignedIpv4: result.wireguard.peer.ipv4Address,
      connectionId: result.connection.id,
      selectionReason: result.selection.reason,
    };
  }
  const result = await api.wireguard.config(input);
  return {
    config: injectPrivateKey(result.config, keys.privateKey),
    fileName: result.fileName,
    server: result.server,
    assignedIpv4: result.peer.ipv4Address,
    connectionId: null,
    selectionReason: result.selection.reason,
  };
}

export function downloadConfig(config: GeneratedConfig): void {
  const blob = new Blob([config.config], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = config.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function configQrCode(config: string): Promise<string> {
  return QRCode.toDataURL(config, { errorCorrectionLevel: 'M', margin: 1, width: 280 });
}
