import { z } from 'zod';
import { hostnameSchema, ipv4Schema, ipv6Schema, wireguardKeySchema } from './common';

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Invalid semver');
const percent = z.number().min(0).max(100);
const nonNegative = z.number().min(0).max(Number.MAX_SAFE_INTEGER);

export const agentRegisterSchema = z.object({
  enrollmentToken: z.string().min(20).max(200),
  hostname: hostnameSchema,
  agentVersion: semverSchema,
  wireguardPublicKey: wireguardKeySchema,
  publicIpv4: ipv4Schema.optional(),
  publicIpv6: ipv6Schema.optional(),
  os: z.string().max(120).optional(),
  kernel: z.string().max(120).optional(),
});
export type AgentRegisterInput = z.infer<typeof agentRegisterSchema>;

export const agentPeerStatSchema = z.object({
  publicKey: wireguardKeySchema,
  /** Unix seconds of the latest handshake, 0 = never. */
  latestHandshake: z.number().int().min(0),
  /** Bytes received from the peer since the previous report. */
  rxBytesDelta: nonNegative,
  /** Bytes sent to the peer since the previous report. */
  txBytesDelta: nonNegative,
});
export type AgentPeerStat = z.infer<typeof agentPeerStatSchema>;

export const healthCheckSchema = z.object({ ok: z.boolean(), message: z.string().max(300).optional() });

export const agentHeartbeatSchema = z.object({
  agentVersion: semverSchema,
  metrics: z.object({
    cpuPercent: percent,
    memoryPercent: percent,
    memoryTotalBytes: nonNegative,
    diskPercent: percent,
    rxBps: nonNegative,
    txBps: nonNegative,
    uptimeSeconds: nonNegative,
    loadAverage: z.tuple([nonNegative, nonNegative, nonNegative]),
  }),
  wireguard: z.object({
    interfaceUp: z.boolean(),
    listenPort: z.number().int().min(0).max(65535),
    peerCount: z.number().int().min(0),
    appliedRevision: z.number().int().min(0),
    totalRxBytes: nonNegative,
    totalTxBytes: nonNegative,
  }),
  publicIpv4: ipv4Schema.optional(),
  publicIpv6: ipv6Schema.optional(),
  health: z.record(z.string().max(64), healthCheckSchema).default({}),
  /** Only peers with a recent handshake or traffic since the previous report. */
  peers: z.array(agentPeerStatSchema).max(50_000).default([]),
});
export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>;

export interface AgentHeartbeatResponse {
  nodeId: string;
  desiredRevision: number;
  heartbeatIntervalSeconds: number;
  maintenance: boolean;
  killSwitch: boolean;
  desiredAgentVersion: string | null;
  updateUrl: string | null;
}

export interface AgentPeerConfig {
  publicKey: string;
  presharedKey: string | null;
  allowedIps: string[];
}

export interface AgentConfigResponse {
  revision: number;
  interface: {
    listenPort: number;
    addressV4: string;
    addressV6: string | null;
    subnetV4: string;
    subnetV6: string | null;
    dns: string[];
  };
  peers: AgentPeerConfig[];
}

export interface AgentRegisterResponse {
  nodeId: string;
  serverId: string;
  serverName: string;
  nodeToken: string;
  heartbeatIntervalSeconds: number;
}
