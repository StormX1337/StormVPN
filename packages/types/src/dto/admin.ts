import type { IsoDate } from './common';
import type {
  ActorType,
  NodeStatus,
  Region,
  RiskSubjectType,
  Role,
  ServerClass,
  ServerStatus,
  Severity,
  SecurityEventType,
  SubscriptionStatus,
  UserStatus,
  VpnProtocol,
  ProviderType,
  ConnectionStatus,
  BillingProvider,
} from '../enums';

export interface AdminStatsDto {
  onlineNodes: number;
  totalNodes: number;
  degradedNodes: number;
  activeUsers: number;
  totalUsers: number;
  activeConnections: number;
  trafficTodayBytes: number;
  apiRequests: number;
  apiErrors: number;
  activeSubscriptions: number;
  maintenanceMode: boolean;
  generatedAt: IsoDate;
}

export interface AdminUserDto {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  riskScore: number;
  suspendedReason: string | null;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  deviceCount: number;
  activeConnections: number;
  lastLoginAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface AdminSubscriptionDto {
  id: string;
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  provider: BillingProvider;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: IsoDate | null;
  cancelAtPeriodEnd: boolean;
  createdAt: IsoDate;
}

export interface NodeMetricsDto {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  rxBps: number;
  txBps: number;
  bandwidthMbps: number;
  activeConnections: number;
  activePeers: number;
  load: number;
  uptimeSeconds: number;
}

export interface AdminNodeDto {
  id: string;
  serverId: string;
  serverName: string;
  hostname: string;
  status: NodeStatus;
  agentVersion: string | null;
  publicIpv4: string | null;
  wireguardPublicKey: string | null;
  metrics: NodeMetricsDto;
  totalRxBytes: number;
  totalTxBytes: number;
  peerRevision: number;
  appliedPeerRevision: number;
  healthChecks: Record<string, { ok: boolean; message?: string }> | null;
  lastHeartbeatAt: IsoDate | null;
  registeredAt: IsoDate;
}

export interface AdminServerDto {
  id: string;
  name: string;
  hostname: string;
  countryCode: string;
  countryName: string;
  city: string;
  region: Region;
  latitude: number | null;
  longitude: number | null;
  publicIpv4: string;
  publicIpv6: string | null;
  privateIp: string | null;
  wireguardPort: number;
  protocol: VpnProtocol;
  provider: ProviderType;
  serverClass: ServerClass;
  status: ServerStatus;
  nodeStatus: NodeStatus | null;
  capacity: number;
  bandwidthCapacityMbps: number;
  wgSubnetV4: string;
  wgSubnetV6: string | null;
  dnsServers: string[];
  killSwitchEngaged: boolean;
  load: number;
  activeConnections: number;
  peerCount: number;
  nodeId: string | null;
  lastHeartbeatAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface EnrollmentTokenDto {
  serverId: string;
  enrollmentToken: string;
  expiresAt: IsoDate;
  installCommand: string;
}

export interface AdminConnectionDto {
  id: string;
  userId: string;
  userEmail: string;
  serverId: string;
  serverName: string;
  deviceName: string | null;
  status: ConnectionStatus;
  startedAt: IsoDate;
  connectedAt: IsoDate | null;
  lastHandshakeAt: IsoDate | null;
  rxBytes: number;
  txBytes: number;
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorType: ActorType;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: IsoDate;
}

export interface AdminSecurityEventDto {
  id: string;
  userId: string | null;
  userEmail: string | null;
  type: SecurityEventType;
  severity: Severity;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: IsoDate;
  resolvedAt: IsoDate | null;
}

export interface RiskFlagDto {
  id: string;
  subjectType: RiskSubjectType;
  subjectValue: string;
  reason: string;
  score: number;
  source: string;
  createdAt: IsoDate;
  expiresAt: IsoDate | null;
  resolvedAt: IsoDate | null;
}

export interface TrafficByServerDto {
  serverId: string;
  serverName: string;
  rxBytes: number;
  txBytes: number;
}

export interface AdminTrafficDto {
  from: IsoDate;
  to: IsoDate;
  totalRxBytes: number;
  totalTxBytes: number;
  daily: { date: string; rxBytes: number; txBytes: number }[];
  byServer: TrafficByServerDto[];
  topUsers: { userId: string; email: string; rxBytes: number; txBytes: number }[];
}

export interface SystemSettingsDto {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  registrationEnabled: boolean;
  defaultDns: string[];
  abuseAutoSuspendScore: number;
  maxConfigGenerationsPerHour: number;
  serverOverloadThreshold: number;
}
