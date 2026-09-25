import type { IsoDate } from './common';
import type {
  ConnectionSource,
  ConnectionStatus,
  DevicePlatform,
  NodeStatus,
  PeerStatus,
  ProviderType,
  Region,
  ServerClass,
  VpnProtocol,
} from '../enums';

export interface ServerDto {
  id: string;
  name: string;
  hostname: string;
  countryCode: string;
  countryName: string;
  city: string;
  region: Region;
  publicIpv4: string;
  publicIpv6: string | null;
  wireguardPort: number;
  protocol: VpnProtocol;
  provider: ProviderType;
  serverClass: ServerClass;
  /** Effective availability derived from admin state and node heartbeats. */
  status: NodeStatus;
  load: number;
  capacity: number;
  availableCapacity: number;
  activeConnections: number;
  latitude: number | null;
  longitude: number | null;
  isFavorite: boolean;
  /** Whether the current user's plan allows connecting to this server. */
  allowed: boolean;
}

export interface DeviceDto {
  id: string;
  name: string;
  platform: DevicePlatform;
  clientVersion: string | null;
  createdAt: IsoDate;
  lastSeenAt: IsoDate | null;
  activePeers: number;
  connected: boolean;
}

export interface PeerDto {
  id: string;
  serverId: string;
  serverName: string;
  publicKey: string;
  ipv4Address: string;
  ipv6Address: string | null;
  status: PeerStatus;
  lastHandshakeAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface ServerSummaryDto {
  id: string;
  name: string;
  countryCode: string;
  countryName: string;
  city: string;
  publicIpv4: string;
}

export interface ConnectionDto {
  id: string;
  status: ConnectionStatus;
  source: ConnectionSource;
  server: ServerSummaryDto;
  deviceId: string | null;
  deviceName: string | null;
  assignedIpv4: string | null;
  startedAt: IsoDate;
  connectedAt: IsoDate | null;
  endedAt: IsoDate | null;
  lastHandshakeAt: IsoDate | null;
  rxBytes: number;
  txBytes: number;
  disconnectReason: string | null;
}

export interface WireGuardConfigDto {
  /** wg-quick config. Contains a placeholder instead of the private key when the client supplied its own public key. */
  config: string;
  fileName: string;
  privateKeyIncluded: boolean;
  peer: PeerDto;
  server: ServerSummaryDto;
}

export interface ConnectResultDto {
  connection: ConnectionDto;
  wireguard: WireGuardConfigDto;
  selection: {
    strategy: 'manual' | 'quick';
    score: number | null;
    reason: string;
  };
}

export interface TrafficPointDto {
  date: string;
  rxBytes: number;
  txBytes: number;
}

export interface TrafficSummaryDto {
  periodStart: IsoDate;
  rxBytes: number;
  txBytes: number;
  limitBytes: number | null;
  daily: TrafficPointDto[];
}

export interface VpnStatusDto {
  connected: boolean;
  connection: ConnectionDto | null;
  publicIp: string;
  killSwitch: {
    /** Kill switch is enforced on the client; reported by native clients. */
    supportedByClient: boolean;
    recommended: boolean;
  };
}
