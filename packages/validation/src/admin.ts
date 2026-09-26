import { z } from 'zod';
import {
  BillingInterval,
  ConnectionStatus,
  CouponDuration,
  Region,
  RiskSubjectType,
  Role,
  SecurityEventType,
  ServerClass,
  ServerStatus,
  Severity,
  SubscriptionStatus,
  UserStatus,
} from '@stormvpn/types';
import {
  booleanQuerySchema,
  countryCodeSchema,
  dateQuerySchema,
  hostnameSchema,
  idSchema,
  ipv4CidrSchema,
  ipv4Schema,
  ipv6CidrSchema,
  ipv6Schema,
  paginationQuerySchema,
} from './common';
import { parseCidr } from './net';
import { couponCodeSchema } from './billing';

const searchSchema = z.string().trim().max(120).optional();

export const adminUsersQuerySchema = paginationQuerySchema.extend({
  search: searchSchema,
  status: z.enum(UserStatus).optional(),
  role: z.enum(Role).optional(),
});

export const suspendUserSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const updateUserRoleSchema = z.object({ role: z.enum(Role) });
export const adminGrantPlanSchema = z.object({
  planId: idSchema,
  /** Complimentary access length in days; omitted = until revoked. */
  days: z.number().int().min(1).max(3650).optional(),
});

export const adminSubscriptionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(SubscriptionStatus).optional(),
  planId: idSchema.optional(),
  search: searchSchema,
});

export const adminPaymentsQuerySchema = paginationQuerySchema.extend({
  search: searchSchema,
});

export const serverNameSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2,3}$/, 'Use the format CC-CITY-NN, e.g. DE-FRA-01');

const wgSubnetV4Schema = ipv4CidrSchema.refine((value) => {
  const prefix = parseCidr(value)?.prefix ?? 0;
  return prefix >= 12 && prefix <= 28;
}, 'Subnet prefix must be between /12 and /28');

const wgSubnetV6Schema = ipv6CidrSchema.refine((value) => {
  const prefix = parseCidr(value)?.prefix ?? 0;
  return prefix >= 48 && prefix <= 120;
}, 'Subnet prefix must be between /48 and /120');

/** Server fields without defaults – used for partial updates. */
const serverFields = {
  name: serverNameSchema,
  hostname: hostnameSchema,
  countryCode: countryCodeSchema,
  city: z.string().trim().min(2).max(64),
  region: z.enum(Region),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  publicIpv4: ipv4Schema,
  publicIpv6: ipv6Schema.nullable(),
  privateIp: ipv4Schema.nullable(),
  wireguardPort: z.number().int().min(1).max(65535),
  serverClass: z.enum(ServerClass),
  capacity: z.number().int().min(1).max(100_000),
  bandwidthCapacityMbps: z.number().int().min(10).max(400_000),
  wgSubnetV4: wgSubnetV4Schema,
  wgSubnetV6: wgSubnetV6Schema.nullable(),
  dnsServers: z.array(z.union([ipv4Schema, ipv6Schema])).max(4),
  tags: z.array(z.string().trim().min(1).max(32)).max(20),
};

export const serverCreateSchema = z.object({
  ...serverFields,
  latitude: serverFields.latitude.optional(),
  longitude: serverFields.longitude.optional(),
  publicIpv6: serverFields.publicIpv6.optional(),
  privateIp: serverFields.privateIp.optional(),
  wireguardPort: serverFields.wireguardPort.default(51820),
  serverClass: serverFields.serverClass.default('STANDARD'),
  capacity: serverFields.capacity.default(500),
  bandwidthCapacityMbps: serverFields.bandwidthCapacityMbps.default(1000),
  wgSubnetV4: serverFields.wgSubnetV4.default('10.80.0.0/20'),
  wgSubnetV6: serverFields.wgSubnetV6.optional(),
  dnsServers: serverFields.dnsServers.optional(),
  tags: serverFields.tags.default([]),
});
export type ServerCreateInput = z.infer<typeof serverCreateSchema>;

/** Partial update: omitted fields stay untouched (no defaults are applied). */
export const serverUpdateSchema = z.object(serverFields).omit({ name: true }).partial();
export type ServerUpdateInput = z.infer<typeof serverUpdateSchema>;

export const serverStatusSchema = z.object({ status: z.enum(ServerStatus) });
export const killSwitchSchema = z.object({
  engaged: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toLowerCase());

/** Plan fields without defaults – used for partial updates. */
const planFields = {
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().trim().min(2).max(64),
  description: z.string().trim().max(500).nullable(),
  priceCents: z.number().int().min(0).max(1_000_000),
  currency: currencySchema,
  billingInterval: z.enum(BillingInterval),
  intervalCount: z.number().int().min(1).max(12),
  trialDays: z.number().int().min(0).max(90),
  maxDevices: z.number().int().min(1).max(100),
  maxSessions: z.number().int().min(1).max(100),
  trafficLimitBytes: z.number().int().min(0).nullable(),
  allowedCountries: z.array(countryCodeSchema).max(250),
  serverClasses: z.array(z.enum(ServerClass)).min(1),
  priority: z.number().int().min(0).max(100),
  features: z.array(z.string().trim().min(1).max(120)).max(30),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};

export const planCreateSchema = z.object({
  ...planFields,
  description: planFields.description.optional(),
  currency: planFields.currency.default('eur'),
  billingInterval: planFields.billingInterval.default('MONTH'),
  intervalCount: planFields.intervalCount.default(1),
  trialDays: planFields.trialDays.default(0),
  trafficLimitBytes: planFields.trafficLimitBytes.default(null),
  allowedCountries: planFields.allowedCountries.default([]),
  serverClasses: planFields.serverClasses.default(['STANDARD']),
  priority: planFields.priority.default(0),
  features: planFields.features.default([]),
  isActive: planFields.isActive.default(true),
  isPublic: planFields.isPublic.default(true),
  sortOrder: planFields.sortOrder.default(0),
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;

/** Partial update: omitted fields stay untouched (no defaults are applied). */
export const planUpdateSchema = z.object(planFields).omit({ slug: true }).partial();
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export const couponCreateSchema = z
  .object({
    code: couponCodeSchema,
    name: z.string().trim().max(100).nullable().optional(),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    amountOffCents: z.number().int().min(1).max(1_000_000).nullable().optional(),
    currency: z
      .string()
      .length(3)
      .transform((value) => value.toLowerCase())
      .nullable()
      .optional(),
    duration: z.enum(CouponDuration).default('ONCE'),
    durationInMonths: z.number().int().min(1).max(36).nullable().optional(),
    maxRedemptions: z.number().int().min(1).nullable().optional(),
    validFrom: z.coerce.date().nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    planIds: z.array(idSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const hasPercent = value.percentOff != null;
    const hasAmount = value.amountOffCents != null;
    if (hasPercent === hasAmount) {
      ctx.addIssue({
        code: 'custom',
        path: ['percentOff'],
        message: 'Set exactly one of percentOff or amountOffCents',
      });
    }
    if (hasAmount && !value.currency) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency is required for amount discounts',
      });
    }
    if (value.duration === 'REPEATING' && !value.durationInMonths) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationInMonths'],
        message: 'Required for repeating coupons',
      });
    }
    if (value.validFrom && value.validUntil && value.validFrom >= value.validUntil) {
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Must be after validFrom' });
    }
  });
export type CouponCreateInput = z.infer<typeof couponCreateSchema>;

export const couponUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
});

export const settingsUpdateSchema = z
  .object({
    maintenanceMode: z.boolean(),
    maintenanceMessage: z.string().trim().max(500).nullable(),
    registrationEnabled: z.boolean(),
    defaultDns: z
      .array(z.union([ipv4Schema, ipv6Schema]))
      .min(1)
      .max(4),
    abuseAutoSuspendScore: z.number().int().min(10).max(1000),
    maxConfigGenerationsPerHour: z.number().int().min(1).max(1000),
    serverOverloadThreshold: z.number().int().min(50).max(100),
  })
  .partial();
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const auditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorId: idSchema.optional(),
  targetType: z.string().trim().max(50).optional(),
  targetId: z.string().trim().max(100).optional(),
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});

export const securityEventsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(SecurityEventType).optional(),
  severity: z.enum(Severity).optional(),
  userId: idSchema.optional(),
  unresolvedOnly: booleanQuerySchema.optional(),
});

export const riskFlagCreateSchema = z.object({
  subjectType: z.enum(RiskSubjectType),
  subjectValue: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(3).max(500),
  score: z.number().int().min(1).max(1000),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .nullable()
    .optional(),
});

export const adminConnectionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ConnectionStatus).optional(),
  serverId: idSchema.optional(),
  userId: idSchema.optional(),
});

export const adminTrafficQuerySchema = z.object({
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});
