/**
 * String enums mirrored from the Prisma schema so they can be used in
 * browser bundles without pulling in the database client.
 * `packages/database` contains a test asserting both stay in sync.
 */
const defineEnum = <const T extends readonly string[]>(values: T) =>
  Object.freeze(Object.fromEntries(values.map((v) => [v, v]))) as { readonly [K in T[number]]: K };

export const Role = defineEnum(['USER', 'SUPPORT', 'ADMIN']);
export type Role = keyof typeof Role;

export const UserStatus = defineEnum(['ACTIVE', 'SUSPENDED', 'BANNED']);
export type UserStatus = keyof typeof UserStatus;

export const DevicePlatform = defineEnum([
  'WINDOWS',
  'MACOS',
  'LINUX',
  'ANDROID',
  'IOS',
  'ROUTER',
  'OTHER',
]);
export type DevicePlatform = keyof typeof DevicePlatform;

export const ClientType = defineEnum(['WEB', 'NATIVE']);
export type ClientType = keyof typeof ClientType;

export const SubscriptionStatus = defineEnum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'UNPAID',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'PAUSED',
]);
export type SubscriptionStatus = keyof typeof SubscriptionStatus;

export const BillingInterval = defineEnum(['DAY', 'WEEK', 'MONTH', 'YEAR']);
export type BillingInterval = keyof typeof BillingInterval;

export const BillingProvider = defineEnum(['NONE', 'STRIPE']);
export type BillingProvider = keyof typeof BillingProvider;

export const PaymentStatus = defineEnum(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']);
export type PaymentStatus = keyof typeof PaymentStatus;

export const InvoiceStatus = defineEnum(['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE']);
export type InvoiceStatus = keyof typeof InvoiceStatus;

export const CouponDuration = defineEnum(['ONCE', 'REPEATING', 'FOREVER']);
export type CouponDuration = keyof typeof CouponDuration;

export const Region = defineEnum([
  'EUROPE',
  'NORTH_AMERICA',
  'SOUTH_AMERICA',
  'ASIA_PACIFIC',
  'MIDDLE_EAST',
  'AFRICA',
  'OCEANIA',
]);
export type Region = keyof typeof Region;

/** Administrative state of a server (controlled by admins). */
export const ServerStatus = defineEnum(['ACTIVE', 'DISABLED', 'MAINTENANCE']);
export type ServerStatus = keyof typeof ServerStatus;

/** Operational state of a node (derived from heartbeats). */
export const NodeStatus = defineEnum(['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']);
export type NodeStatus = keyof typeof NodeStatus;

export const ServerClass = defineEnum(['STANDARD', 'PREMIUM', 'STREAMING']);
export type ServerClass = keyof typeof ServerClass;

export const VpnProtocol = defineEnum(['WIREGUARD']);
export type VpnProtocol = keyof typeof VpnProtocol;

export const ProviderType = defineEnum(['OWN_WIREGUARD', 'PARTNER']);
export type ProviderType = keyof typeof ProviderType;

export const PeerStatus = defineEnum(['ACTIVE', 'DISABLED']);
export type PeerStatus = keyof typeof PeerStatus;

export const ConnectionStatus = defineEnum(['CONNECTING', 'CONNECTED', 'DISCONNECTED', 'FAILED']);
export type ConnectionStatus = keyof typeof ConnectionStatus;

export const ConnectionSource = defineEnum(['API', 'CONFIG']);
export type ConnectionSource = keyof typeof ConnectionSource;

export const Severity = defineEnum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type Severity = keyof typeof Severity;

export const ActorType = defineEnum(['USER', 'ADMIN', 'SYSTEM', 'NODE']);
export type ActorType = keyof typeof ActorType;

export const RiskSubjectType = defineEnum(['USER', 'IP']);
export type RiskSubjectType = keyof typeof RiskSubjectType;

export const SecurityEventType = defineEnum([
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_LOCKED',
  'MFA_FAILED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET',
  'EMAIL_VERIFIED',
  'REFRESH_TOKEN_REUSE',
  'SESSION_REVOKED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_UNSUSPENDED',
  'RATE_LIMITED',
  'DEVICE_LIMIT_REACHED',
  'CONNECTION_LIMIT_REACHED',
  'TRAFFIC_LIMIT_REACHED',
  'ABUSE_SUSPECTED',
  'NODE_AUTH_FAILED',
  'NODE_REGISTERED',
  'SERVER_KILL_SWITCH',
  'ADMIN_ACTION',
]);
export type SecurityEventType = keyof typeof SecurityEventType;
