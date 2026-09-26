import { z } from 'zod';
import { isValidWireGuardKey } from '@stormvpn/crypto';
import { isCidr, isIPv4, isIPv6, parseCidr } from './net';

export const idSchema = z.uuid();
export const idParamsSchema = z.object({ id: idSchema });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: 'Invalid email address' }))
  .transform((value) => value.toLowerCase());

/**
 * NIST SP 800-63B aligned: length over complexity, max 128 to bound hashing cost.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((value) => new Set(value).size >= 5, 'Password is too repetitive');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) => !/[<>{}\\]/.test(value) && ![...value].some((char) => char.charCodeAt(0) < 32),
    {
      message: 'Name contains invalid characters',
    },
  );

export const countryCodeSchema = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase());

export const ipv4Schema = z.string().trim().refine(isIPv4, 'Invalid IPv4 address');
export const ipv6Schema = z.string().trim().refine(isIPv6, 'Invalid IPv6 address');
export const cidrSchema = z.string().trim().refine(isCidr, 'Invalid CIDR');
export const ipv4CidrSchema = z
  .string()
  .trim()
  .refine((value) => parseCidr(value)?.version === 4, 'Invalid IPv4 CIDR');
export const ipv6CidrSchema = z
  .string()
  .trim()
  .refine((value) => parseCidr(value)?.version === 6, 'Invalid IPv6 CIDR');

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
    'Invalid hostname',
  );

export const wireguardKeySchema = z
  .string()
  .trim()
  .refine(isValidWireGuardKey, 'Invalid WireGuard key');

export const booleanQuerySchema = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const dateQuerySchema = z.coerce.date();
