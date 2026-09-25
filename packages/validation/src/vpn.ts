import { z } from 'zod';
import { DevicePlatform, Region, ServerClass } from '@stormvpn/types';
import { booleanQuerySchema, cidrSchema, countryCodeSchema, idSchema, wireguardKeySchema } from './common';

export const deviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N} ._'()-]+$/u, 'Device name contains invalid characters');

export const createDeviceSchema = z.object({
  name: deviceNameSchema,
  platform: z.enum(DevicePlatform),
  clientVersion: z.string().trim().max(32).optional(),
});
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;

export const updateDeviceSchema = z.object({ name: deviceNameSchema });

export const listServersQuerySchema = z.object({
  country: countryCodeSchema.optional(),
  region: z.enum(Region).optional(),
  city: z.string().trim().max(64).optional(),
  serverClass: z.enum(ServerClass).optional(),
  search: z.string().trim().max(64).optional(),
  onlyAvailable: booleanQuerySchema.optional(),
});
export type ListServersQuery = z.infer<typeof listServersQuerySchema>;

/** Client measured round-trip times in ms keyed by server id. */
const latencyMapSchema = z
  .record(idSchema, z.number().min(0).max(10_000))
  .refine((value) => Object.keys(value).length <= 500, 'Too many latency samples');

const allowedIpsSchema = z.array(cidrSchema).min(1).max(64);

const targetSchema = {
  deviceId: idSchema,
  /** Explicit server; omitted = Quick Connect. */
  serverId: idSchema.optional(),
  country: countryCodeSchema.optional(),
  region: z.enum(Region).optional(),
  city: z.string().trim().max(64).optional(),
  /**
   * Client generated public key (recommended). When omitted the API generates
   * a key pair, returns the private key exactly once and never stores it.
   */
  publicKey: wireguardKeySchema.optional(),
  /** Split tunnelling – defaults to full tunnel (0.0.0.0/0, ::/0). */
  allowedIps: allowedIpsSchema.optional(),
};

export const createConnectionSchema = z.object({
  ...targetSchema,
  latencies: latencyMapSchema.optional(),
});
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const wireguardConfigSchema = z.object({
  ...targetSchema,
  latencies: latencyMapSchema.optional(),
});
export type WireGuardConfigInput = z.infer<typeof wireguardConfigSchema>;

export const connectionHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const trafficQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
