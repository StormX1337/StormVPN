import type { IsoDate } from './common';
import type {
  BillingInterval,
  BillingProvider,
  CouponDuration,
  InvoiceStatus,
  PaymentStatus,
  ServerClass,
  SubscriptionStatus,
} from '../enums';

export interface PlanDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  billingInterval: BillingInterval;
  intervalCount: number;
  trialDays: number;
  maxDevices: number;
  maxSessions: number;
  /** Monthly traffic allowance in bytes, null = unlimited. */
  trafficLimitBytes: number | null;
  /** ISO 3166-1 alpha-2 codes, empty = all countries. */
  allowedCountries: string[];
  serverClasses: ServerClass[];
  priority: number;
  features: string[];
  isFree: boolean;
}

export interface AdminPlanDto extends PlanDto {
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  stripeProductId: string | null;
  stripePriceId: string | null;
  subscriberCount: number;
  createdAt: IsoDate;
}

export interface PaymentMethodDto {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export interface SubscriptionDto {
  id: string;
  status: SubscriptionStatus;
  provider: BillingProvider;
  plan: PlanDto;
  currentPeriodStart: IsoDate | null;
  currentPeriodEnd: IsoDate | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: IsoDate | null;
  trialEnd: IsoDate | null;
  paymentMethod: PaymentMethodDto | null;
}

export interface UsageDto {
  devicesUsed: number;
  activeConnections: number;
  trafficUsedBytes: number;
  periodStart: IsoDate;
}

export interface SubscriptionOverviewDto {
  subscription: SubscriptionDto | null;
  usage: UsageDto;
  trialEligible: boolean;
}

export interface InvoiceDto {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  paidAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface PaymentDto {
  id: string;
  userId: string;
  userEmail?: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  provider: BillingProvider;
  failureReason: string | null;
  createdAt: IsoDate;
  paidAt: IsoDate | null;
}

export interface CheckoutSessionDto {
  url: string;
}

export interface CouponDto {
  id: string;
  code: string;
  name: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string | null;
  duration: CouponDuration;
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  validFrom: IsoDate | null;
  validUntil: IsoDate | null;
  isActive: boolean;
  planIds: string[];
  stripeCouponId: string | null;
  createdAt: IsoDate;
}
