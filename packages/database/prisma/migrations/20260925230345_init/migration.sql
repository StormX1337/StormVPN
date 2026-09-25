-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('WEB', 'NATIVE');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('WINDOWS', 'MACOS', 'LINUX', 'ANDROID', 'IOS', 'ROUTER', 'OTHER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAUSED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('NONE', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "CouponDuration" AS ENUM ('ONCE', 'REPEATING', 'FOREVER');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('EUROPE', 'NORTH_AMERICA', 'SOUTH_AMERICA', 'ASIA_PACIFIC', 'MIDDLE_EAST', 'AFRICA', 'OCEANIA');

-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('ACTIVE', 'DISABLED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ServerClass" AS ENUM ('STANDARD', 'PREMIUM', 'STREAMING');

-- CreateEnum
CREATE TYPE "VpnProtocol" AS ENUM ('WIREGUARD');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('OWN_WIREGUARD', 'PARTNER');

-- CreateEnum
CREATE TYPE "PeerStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTING', 'CONNECTED', 'DISCONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConnectionSource" AS ENUM ('API', 'CONFIG');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'NODE');

-- CreateEnum
CREATE TYPE "RiskSubjectType" AS ENUM ('USER', 'IP');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "name" VARCHAR(100),
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" VARCHAR(500),
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastUsedStep" INTEGER,
    "stripeCustomerId" TEXT,
    "trialUsedAt" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "preferredCountry" CHAR(2),
    "preferredRegion" "Region",
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" VARCHAR(45),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" CHAR(64) NOT NULL,
    "previousRefreshTokenHash" CHAR(64),
    "rotatedAt" TIMESTAMP(3),
    "clientType" "ClientType" NOT NULL DEFAULT 'WEB',
    "userAgent" VARCHAR(512),
    "ipAddress" VARCHAR(45),
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(100),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "clientVersion" VARCHAR(32),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "userId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("userId","serverId")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(42) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),
    "priceCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'eur',
    "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "maxDevices" INTEGER NOT NULL,
    "maxSessions" INTEGER NOT NULL,
    "trafficLimitBytes" BIGINT,
    "allowedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serverClasses" "ServerClass"[] DEFAULT ARRAY['STANDARD']::"ServerClass"[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'NONE',
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "couponId" UUID,
    "paymentMethodBrand" VARCHAR(32),
    "paymentMethodLast4" CHAR(4),
    "paymentMethodExpMonth" INTEGER,
    "paymentMethodExpYear" INTEGER,
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "subscriptionId" UUID,
    "stripeInvoiceId" TEXT,
    "number" VARCHAR(64),
    "status" "InvoiceStatus" NOT NULL,
    "amountDueCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "hostedInvoiceUrl" TEXT,
    "invoicePdfUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "subscriptionId" UUID,
    "invoiceId" UUID,
    "amountCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'STRIPE',
    "providerReference" TEXT,
    "failureReason" VARCHAR(500),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100),
    "percentOff" INTEGER,
    "amountOffCents" INTEGER,
    "currency" CHAR(3),
    "duration" "CouponDuration" NOT NULL DEFAULT 'ONCE',
    "durationInMonths" INTEGER,
    "maxRedemptions" INTEGER,
    "timesRedeemed" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stripeCouponId" TEXT,
    "stripePromotionCodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" VARCHAR(255) NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" VARCHAR(2000),
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_servers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "hostname" VARCHAR(253) NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "city" VARCHAR(64) NOT NULL,
    "region" "Region" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "publicIpv4" VARCHAR(15) NOT NULL,
    "publicIpv6" VARCHAR(45),
    "privateIp" VARCHAR(45),
    "wireguardPort" INTEGER NOT NULL DEFAULT 51820,
    "protocol" "VpnProtocol" NOT NULL DEFAULT 'WIREGUARD',
    "provider" "ProviderType" NOT NULL DEFAULT 'OWN_WIREGUARD',
    "serverClass" "ServerClass" NOT NULL DEFAULT 'STANDARD',
    "status" "ServerStatus" NOT NULL DEFAULT 'ACTIVE',
    "capacity" INTEGER NOT NULL DEFAULT 500,
    "bandwidthCapacityMbps" INTEGER NOT NULL DEFAULT 1000,
    "wgSubnetV4" VARCHAR(18) NOT NULL DEFAULT '10.80.0.0/20',
    "wgSubnetV6" VARCHAR(49),
    "dnsServers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" VARCHAR(500),
    "peerRevision" INTEGER NOT NULL DEFAULT 1,
    "enrollmentTokenHash" CHAR(64),
    "enrollmentExpiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vpn_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_nodes" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "tokenPrefix" VARCHAR(16) NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'OFFLINE',
    "agentVersion" VARCHAR(32),
    "hostname" VARCHAR(253) NOT NULL,
    "os" VARCHAR(120),
    "kernel" VARCHAR(120),
    "wireguardPublicKey" CHAR(44) NOT NULL,
    "publicIpv4" VARCHAR(15),
    "publicIpv6" VARCHAR(45),
    "cpuPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memoryPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memoryTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "diskPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rxBps" BIGINT NOT NULL DEFAULT 0,
    "txBps" BIGINT NOT NULL DEFAULT 0,
    "loadPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeConnections" INTEGER NOT NULL DEFAULT 0,
    "activePeers" INTEGER NOT NULL DEFAULT 0,
    "totalRxBytes" BIGINT NOT NULL DEFAULT 0,
    "totalTxBytes" BIGINT NOT NULL DEFAULT 0,
    "uptimeSeconds" BIGINT NOT NULL DEFAULT 0,
    "appliedPeerRevision" INTEGER NOT NULL DEFAULT 0,
    "healthChecks" JSONB,
    "lastHeartbeatAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenRotatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vpn_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_heartbeats" (
    "id" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "status" "NodeStatus" NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryPercent" DOUBLE PRECISION NOT NULL,
    "diskPercent" DOUBLE PRECISION NOT NULL,
    "rxBps" BIGINT NOT NULL,
    "txBps" BIGINT NOT NULL,
    "loadPercent" DOUBLE PRECISION NOT NULL,
    "activeConnections" INTEGER NOT NULL,
    "activePeers" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_peers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "publicKey" CHAR(44) NOT NULL,
    "presharedKeyEnc" TEXT,
    "ipv4Address" VARCHAR(15) NOT NULL,
    "ipv6Address" VARCHAR(45),
    "status" "PeerStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledReason" VARCHAR(200),
    "lastHandshakeAt" TIMESTAMP(3),
    "rxBytes" BIGINT NOT NULL DEFAULT 0,
    "txBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vpn_peers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_connections" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,
    "peerId" UUID,
    "serverId" UUID NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTING',
    "source" "ConnectionSource" NOT NULL DEFAULT 'API',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastHandshakeAt" TIMESTAMP(3),
    "rxBytes" BIGINT NOT NULL DEFAULT 0,
    "txBytes" BIGINT NOT NULL DEFAULT 0,
    "disconnectReason" VARCHAR(100),

    CONSTRAINT "vpn_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_usage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "rxBytes" BIGINT NOT NULL DEFAULT 0,
    "txBytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traffic_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorType" "ActorType" NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(50),
    "targetId" VARCHAR(100),
    "metadata" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "type" VARCHAR(50) NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "metadata" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_flags" (
    "id" UUID NOT NULL,
    "subjectType" "RiskSubjectType" NOT NULL,
    "subjectValue" VARCHAR(100) NOT NULL,
    "userId" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "score" INTEGER NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'AUTOMATED',
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_previousRefreshTokenHash_idx" ON "sessions"("previousRefreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_userId_purpose_idx" ON "verification_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "verification_tokens_expiresAt_idx" ON "verification_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "backup_codes_userId_codeHash_key" ON "backup_codes"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX "user_favorites_serverId_idx" ON "user_favorites"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripeProductId_key" ON "plans"("stripeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripePriceId_key" ON "plans"("stripePriceId");

-- CreateIndex
CREATE INDEX "plans_isActive_isPublic_sortOrder_idx" ON "plans"("isActive", "isPublic", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "subscriptions"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripeInvoiceId_key" ON "invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_userId_createdAt_idx" ON "invoices"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerReference_key" ON "payments"("providerReference");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_stripeCouponId_key" ON "coupons"("stripeCouponId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_stripePromotionCodeId_key" ON "coupons"("stripePromotionCodeId");

-- CreateIndex
CREATE INDEX "coupons_isActive_validUntil_idx" ON "coupons"("isActive", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_userId_key" ON "coupon_redemptions"("couponId", "userId");

-- CreateIndex
CREATE INDEX "webhook_events_status_receivedAt_idx" ON "webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_servers_name_key" ON "vpn_servers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_servers_hostname_key" ON "vpn_servers"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_servers_enrollmentTokenHash_key" ON "vpn_servers"("enrollmentTokenHash");

-- CreateIndex
CREATE INDEX "vpn_servers_status_countryCode_idx" ON "vpn_servers"("status", "countryCode");

-- CreateIndex
CREATE INDEX "vpn_servers_region_idx" ON "vpn_servers"("region");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_nodes_serverId_key" ON "vpn_nodes"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_nodes_tokenHash_key" ON "vpn_nodes"("tokenHash");

-- CreateIndex
CREATE INDEX "vpn_nodes_status_lastHeartbeatAt_idx" ON "vpn_nodes"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "node_heartbeats_nodeId_createdAt_idx" ON "node_heartbeats"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "node_heartbeats_createdAt_idx" ON "node_heartbeats"("createdAt");

-- CreateIndex
CREATE INDEX "vpn_peers_userId_status_idx" ON "vpn_peers"("userId", "status");

-- CreateIndex
CREATE INDEX "vpn_peers_serverId_status_idx" ON "vpn_peers"("serverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_peers_serverId_publicKey_key" ON "vpn_peers"("serverId", "publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_peers_serverId_ipv4Address_key" ON "vpn_peers"("serverId", "ipv4Address");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_peers_deviceId_serverId_key" ON "vpn_peers"("deviceId", "serverId");

-- CreateIndex
CREATE INDEX "vpn_connections_userId_status_idx" ON "vpn_connections"("userId", "status");

-- CreateIndex
CREATE INDEX "vpn_connections_serverId_status_idx" ON "vpn_connections"("serverId", "status");

-- CreateIndex
CREATE INDEX "vpn_connections_peerId_status_idx" ON "vpn_connections"("peerId", "status");

-- CreateIndex
CREATE INDEX "vpn_connections_status_lastHandshakeAt_idx" ON "vpn_connections"("status", "lastHandshakeAt");

-- CreateIndex
CREATE INDEX "vpn_connections_startedAt_idx" ON "vpn_connections"("startedAt");

-- CreateIndex
CREATE INDEX "traffic_usage_day_idx" ON "traffic_usage"("day");

-- CreateIndex
CREATE INDEX "traffic_usage_serverId_day_idx" ON "traffic_usage"("serverId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "traffic_usage_userId_serverId_day_key" ON "traffic_usage"("userId", "serverId", "day");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "security_events_userId_createdAt_idx" ON "security_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_type_createdAt_idx" ON "security_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_severity_resolvedAt_idx" ON "security_events"("severity", "resolvedAt");

-- CreateIndex
CREATE INDEX "security_events_createdAt_idx" ON "security_events"("createdAt");

-- CreateIndex
CREATE INDEX "risk_flags_subjectType_subjectValue_idx" ON "risk_flags"("subjectType", "subjectValue");

-- CreateIndex
CREATE INDEX "risk_flags_userId_resolvedAt_idx" ON "risk_flags"("userId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "vpn_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_nodes" ADD CONSTRAINT "vpn_nodes_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "vpn_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_heartbeats" ADD CONSTRAINT "node_heartbeats_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "vpn_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_peers" ADD CONSTRAINT "vpn_peers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_peers" ADD CONSTRAINT "vpn_peers_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_peers" ADD CONSTRAINT "vpn_peers_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "vpn_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_connections" ADD CONSTRAINT "vpn_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_connections" ADD CONSTRAINT "vpn_connections_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_connections" ADD CONSTRAINT "vpn_connections_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "vpn_peers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_connections" ADD CONSTRAINT "vpn_connections_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "vpn_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_usage" ADD CONSTRAINT "traffic_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_usage" ADD CONSTRAINT "traffic_usage_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "vpn_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
