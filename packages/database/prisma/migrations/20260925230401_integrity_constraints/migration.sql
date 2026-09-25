-- Integrity constraints that Prisma cannot express declaratively.

-- A user can have at most one live (entitling) subscription at a time.
CREATE UNIQUE INDEX "subscriptions_one_live_per_user"
  ON "subscriptions" ("userId")
  WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

-- Plans
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_non_negative" CHECK ("priceCents" >= 0),
  ADD CONSTRAINT "plans_limits_positive" CHECK ("maxDevices" > 0 AND "maxSessions" > 0 AND "intervalCount" > 0),
  ADD CONSTRAINT "plans_trial_non_negative" CHECK ("trialDays" >= 0),
  ADD CONSTRAINT "plans_traffic_non_negative" CHECK ("trafficLimitBytes" IS NULL OR "trafficLimitBytes" >= 0);

-- Coupons: exactly one discount type
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_single_discount" CHECK (("percentOff" IS NULL) <> ("amountOffCents" IS NULL)),
  ADD CONSTRAINT "coupons_percent_range" CHECK ("percentOff" IS NULL OR ("percentOff" BETWEEN 1 AND 100)),
  ADD CONSTRAINT "coupons_redemptions_non_negative" CHECK ("timesRedeemed" >= 0);

-- Servers
ALTER TABLE "vpn_servers"
  ADD CONSTRAINT "vpn_servers_port_range" CHECK ("wireguardPort" BETWEEN 1 AND 65535),
  ADD CONSTRAINT "vpn_servers_capacity_positive" CHECK ("capacity" > 0);

-- Counters never go negative
ALTER TABLE "traffic_usage"
  ADD CONSTRAINT "traffic_usage_non_negative" CHECK ("rxBytes" >= 0 AND "txBytes" >= 0);
ALTER TABLE "vpn_connections"
  ADD CONSTRAINT "vpn_connections_non_negative" CHECK ("rxBytes" >= 0 AND "txBytes" >= 0);
