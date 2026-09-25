import type { Redis } from 'ioredis';
import type { Logger } from '@stormvpn/config';
import { type EventPublisher, type MailQueue, SettingsService } from '@stormvpn/core';
import { DataEncryptor } from '@stormvpn/crypto/node';
import type { Database } from '@stormvpn/database';
import type { ApiEnv } from './env';
import type { Clock } from './lib/clock';
import { RedisCounter } from './lib/counter';
import { AccountService } from './modules/account/account.service';
import { MfaService } from './modules/account/mfa.service';
import { AdminBillingService } from './modules/admin/admin-billing.service';
import { AdminInfraService } from './modules/admin/admin-infra.service';
import { AdminSecurityService } from './modules/admin/admin-security.service';
import { AdminUserService } from './modules/admin/admin-users.service';
import { AdminStatsService } from './modules/admin/stats.service';
import { AgentService } from './modules/agent/agent.service';
import { TelemetryService } from './modules/agent/telemetry.service';
import { AuthService } from './modules/auth/auth.service';
import { BruteForceGuard } from './modules/auth/brute-force';
import { SessionService } from './modules/auth/session.service';
import { TokenService } from './modules/auth/token.service';
import { BillingService } from './modules/billing/billing.service';
import { StripeCatalogService } from './modules/billing/catalog.service';
import { CouponService } from './modules/billing/coupon.service';
import type { StripeGateway } from './modules/billing/stripe.gateway';
import { SubscriptionSyncService } from './modules/billing/subscription-sync.service';
import { StripeWebhookService } from './modules/billing/webhook.service';
import { VpnAccessGuard } from './modules/connections/access-guard';
import { ConnectionService } from './modules/connections/connection.service';
import { DeviceService } from './modules/devices/device.service';
import { OwnWireGuardProvider } from './modules/providers/own-wireguard.provider';
import { type PartnerApiClient, PartnerProvider } from './modules/providers/partner.provider';
import { ProviderRegistry } from './modules/providers/provider-registry';
import { RealtimeHub } from './modules/realtime/realtime.hub';
import { ServerSelectionService } from './modules/selection/selection.service';
import { ServerCatalog } from './modules/servers/server-catalog';
import { ServerService } from './modules/servers/server.service';
import { TrafficService } from './modules/traffic/traffic.service';
import { PeerService } from './modules/wireguard/peer.service';

/** External resources injected into the application (swapped for fakes in tests). */
export interface AppDeps {
  env: ApiEnv;
  db: Database;
  redis: Redis;
  /** Dedicated connection for pub/sub (a subscribed ioredis client cannot run commands). */
  redisSubscriber: Redis;
  logger: Logger;
  mail: MailQueue;
  events: EventPublisher;
  stripe: StripeGateway | null;
  clock: Clock;
  random?: () => number;
  partnerClient?: PartnerApiClient | null;
}

/** Composition root: wires every service once per process. */
export function createServices(deps: AppDeps) {
  const { env, db, redis, clock, logger, mail, events } = deps;
  const encryptor = new DataEncryptor(
    env.DATA_ENCRYPTION_KEY,
    env.DATA_ENCRYPTION_KEY_PREVIOUS ? [env.DATA_ENCRYPTION_KEY_PREVIOUS] : [],
  );
  const counter = new RedisCounter(redis);
  const settings = new SettingsService(db);

  const tokens = new TokenService(env, clock);
  const sessions = new SessionService(db, redis, tokens, env, clock);
  const mfa = new MfaService(db, redis, encryptor, clock);
  const bruteForce = new BruteForceGuard(counter, env);
  const auth = new AuthService(db, redis, env, sessions, mfa, bruteForce, counter, mail, settings, clock);

  const catalog = new ServerCatalog(db, clock, env.NODE_OFFLINE_AFTER_SECONDS);
  const selection = new ServerSelectionService(db, catalog, settings, deps.random);
  const peers = new PeerService(db, encryptor);
  const providers = new ProviderRegistry()
    .register(new OwnWireGuardProvider(peers, settings, env))
    .register(new PartnerProvider(deps.partnerClient ?? null));
  const access = new VpnAccessGuard(db, settings, env, clock);
  const connections = new ConnectionService(db, access, selection, providers, settings, counter, events, clock);

  const stripeGateway = deps.stripe;
  const stripeCatalog = new StripeCatalogService(db, stripeGateway);
  const coupons = new CouponService(db, clock);
  const subscriptionSync = stripeGateway ? new SubscriptionSyncService(db, stripeGateway, clock, logger) : null;
  const stripeWebhooks = subscriptionSync ? new StripeWebhookService(db, subscriptionSync, mail, clock, logger) : null;
  const billing = new BillingService(db, stripeGateway, stripeCatalog, coupons, subscriptionSync, env, clock);
  const account = new AccountService(db, redis, sessions, mail, clock, [billing]);

  const telemetry = new TelemetryService(db, events, clock);
  const agent = new AgentService(db, redis, peers, telemetry, catalog, events, env, clock);
  const adminStats = new AdminStatsService(db, redis, settings, clock);

  return {
    settings,
    tokens,
    sessions,
    mfa,
    auth,
    account,
    catalog,
    selection,
    peers,
    providers,
    connections,
    devices: new DeviceService(db, peers, clock),
    servers: new ServerService(db, catalog),
    traffic: new TrafficService(db, clock),
    stripeGateway,
    billing,
    coupons,
    stripeWebhooks,
    agent,
    adminStats,
    adminUsers: new AdminUserService(db, redis, sessions, mail, clock),
    adminInfra: new AdminInfraService(db, catalog, connections, env, clock),
    adminBilling: new AdminBillingService(db, stripeCatalog, stripeGateway, subscriptionSync),
    adminSecurity: new AdminSecurityService(db, settings, clock),
    realtime: new RealtimeHub(deps.redisSubscriber, adminStats, logger),
  };
}

export type Services = ReturnType<typeof createServices>;
