# StormVPN

StormVPN is a self-hosted VPN platform (SaaS) built on **WireGuard®**. Customers sign up, pick a plan, pay with Stripe, choose a location (or use Quick Connect) and get a WireGuard configuration that connects to **StormVPN-operated nodes**. Operators manage the fleet, customers, billing and abuse from an admin panel with live telemetry.

```
Internet → Cloudflare/Edge → Nginx → Web (Next.js) / Admin (Next.js) / API (Fastify)
                                                   API → PostgreSQL · Redis → Worker · Scheduler
                                                   API ⇄ Node agents (HTTPS) → WireGuard → NAT → Internet
```

| Area          | Highlights                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPN           | WireGuard with per-device keys generated **on the client** (private keys never reach the server), pre-shared keys (AES-256-GCM at rest), IPv4 + IPv6, node-local no-log DNS, atomic peer sync (`wg syncconf`) |
| Fleet         | Node agent with enrollment tokens, heartbeats, metrics, health checks, server kill switch, maintenance mode, Prometheus metrics – designed for hundreds/thousands of nodes                                    |
| Quick Connect | Server selection engine (load, latency, capacity, plan, preferences) with overload protection and priority headroom                                                                                           |
| Billing       | Stripe Checkout, Customer Portal, trials, coupons, proration, idempotent order-independent webhooks, invoices                                                                                                 |
| Security      | Argon2id, rotating refresh tokens with reuse detection, TOTP 2FA + backup codes, CSRF, rate limits, brute-force lockout, audit + security logs, abuse scoring with auto-suspend                               |
| Apps          | Customer dashboard and admin panel (Next.js 16, Tailwind v4, shadcn-style UI, dark/light mode, responsive), live updates via WebSocket                                                                        |

> **Provider policy.** StormVPN runs on its own infrastructure. There is **no** integration with private or undocumented APIs of other VPN vendors (e.g. NordVPN) – no scraping, no reverse engineering, no credential reuse. A `PartnerProvider` extension point exists for _officially licensed_ partner/reseller APIs only (see [ARCHITECTURE.md](docs/ARCHITECTURE.md#vpn-provider-layer)).

## Repository layout

```
apps/
  api/           Fastify REST + WebSocket API (auth, VPN, billing, admin, node agent endpoints)
  web/           Customer app (Next.js) – landing, auth, dashboard, servers, devices, subscription, account
  admin/         Admin panel (Next.js, served under /admin)
services/
  node-agent/    Agent running on every VPN node (single-file bundle)
  worker/        BullMQ worker: emails + maintenance jobs
  scheduler/     Registers repeatable maintenance schedules
packages/
  database/      Prisma 7 schema, migrations, client, seed
  core/          Domain logic shared by API/worker (entitlements, peer reconciliation, jobs)
  config/        Environment schemas (zod), structured logging (pino)
  crypto/        WireGuard keys + config rendering (browser-safe), argon2id, AES-GCM, TOTP, tokens
  validation/    zod request schemas shared by API and frontends
  types/         DTOs, enums, geo data
  api-client/    Typed API client (browser + future native apps)
  ui/            Design system (tokens, components, charts)
infra/
  docker/        Dockerfiles (services, Next apps, node agent)
  nginx/         Reverse proxy (dev + production TLS)
  wireguard/     Node installer, systemd unit, nftables, Unbound, sysctl, updater
  monitoring/    Prometheus config + alerts, Grafana provisioning + dashboard
docs/            Architecture, security, deployment, API, node setup, WireGuard, Stripe, admin
scripts/         Agent packaging, demo fleet simulator
```

## Quick start (development)

Requirements: Node.js ≥ 22.18, pnpm 10, Docker (for PostgreSQL/Redis) – or local PostgreSQL 16 + Redis 7.

```bash
# 1. Install dependencies and configure secrets
pnpm install
cp .env.example .env
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
sed -i "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env

# 2. + 3. Start PostgreSQL and Redis (and Mailpit for emails)
docker compose up -d postgres redis mailpit

# 4. Build shared packages and apply migrations
pnpm build:packages
pnpm db:deploy            # or: pnpm db:migrate (creates new migrations during development)

# 5. Seed demo data (admin, demo user, plans, 9 servers, 8 simulated nodes, traffic history)
pnpm db:seed

# 6. + 7. Start API, worker, scheduler, web and admin in watch mode
pnpm dev
#   Web     http://localhost:3000      demo@stormvpn.local / StormDemo!2026
#   Admin   http://localhost:3001/admin admin@stormvpn.local / StormAdmin!2026
#   API     http://localhost:4000      health: /health/ready
#   Mail    http://localhost:8025

# Optional: keep the simulated demo nodes online (real agent API code path)
pnpm demo:fleet
```

Full stack in containers (Nginx on http://localhost:8080): `docker compose up -d --build` – see [DEPLOYMENT.md](docs/DEPLOYMENT.md).

Steps 8–12 (install a real VPN node, register it, WireGuard, Stripe, production): [NODE-SETUP.md](docs/NODE-SETUP.md) · [WIREGUARD.md](docs/WIREGUARD.md) · [STRIPE.md](docs/STRIPE.md) · [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Common commands

| Command                                                   | Purpose                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                                                | Watch mode for API, worker, scheduler, web, admin                                        |
| `pnpm build`                                              | Build everything (Turborepo)                                                             |
| `pnpm lint` / `pnpm typecheck` / `pnpm format`            | Quality gates                                                                            |
| `pnpm test`                                               | Unit tests of all packages                                                               |
| `pnpm test:integration`                                   | API integration tests against PostgreSQL + Redis (`TEST_DATABASE_URL`, `TEST_REDIS_URL`) |
| `pnpm db:migrate` / `pnpm db:deploy` / `pnpm db:generate` | Prisma migrate dev / deploy / generate                                                   |
| `pnpm db:seed`                                            | Development seed (refuses to run in production)                                          |
| `scripts/package-agent.sh`                                | Build the node agent release tarball + checksum                                          |

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) – components, data flows, scaling, design decisions, future clients
- [SECURITY.md](docs/SECURITY.md) – threat model and security controls, privacy & retention
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) – development and production deployment
- [API.md](docs/API.md) – REST/WebSocket reference (v1)
- [NODE-SETUP.md](docs/NODE-SETUP.md) – installing and registering VPN nodes
- [WIREGUARD.md](docs/WIREGUARD.md) – keys, addressing, config generation, client hardening
- [STRIPE.md](docs/STRIPE.md) – billing setup and webhooks
- [ADMIN.md](docs/ADMIN.md) – operating the admin panel

## Tech stack

TypeScript (strict) · Node.js 22 · Fastify 5 · zod 4 · Prisma 7 (driver adapter, no native engine) · PostgreSQL 16 · Redis 7 · BullMQ · Next.js 16 · React 19 · Tailwind CSS 4 · Radix UI · Recharts · Stripe · WireGuard · nftables · Unbound · Docker · Nginx · Prometheus · Grafana · Vitest · Turborepo · pnpm.

_WireGuard is a registered trademark of Jason A. Donenfeld._
