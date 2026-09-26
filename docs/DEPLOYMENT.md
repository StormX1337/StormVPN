# Deployment

This guide covers local development (steps 1–7) and a production deployment on Ubuntu/Debian with Docker (step 12). VPN nodes are covered in [NODE-SETUP.md](NODE-SETUP.md), Stripe in [STRIPE.md](STRIPE.md).

## Development

### 1. Start development

```bash
git clone <repo> stormvpn && cd stormvpn
corepack enable            # or: npm i -g pnpm@10
pnpm install
cp .env.example .env
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
sed -i "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
pnpm build:packages
```

### 2. Start PostgreSQL · 3. Start Redis

```bash
docker compose up -d postgres redis mailpit
```

(Or use local services: PostgreSQL 16 with the user/database from `.env`, Redis 7.)

### 4. Run migrations

```bash
pnpm db:deploy     # apply committed migrations
pnpm db:migrate    # during schema development: create + apply a new migration
pnpm db:generate   # regenerate the Prisma client (also part of the database build)
```

### 5. Seed

```bash
pnpm db:seed
```

Creates `admin@stormvpn.local` / `StormAdmin!2026`, `demo@stormvpn.local` / `StormDemo!2026` (override via `SEED_*` env), four plans, nine servers (DE-FRA-01/02, DE-BER-01, NL-AMS-01, FR-PAR-01, UK-LON-01, US-NYC-01, US-LAX-01, US-CHI-01), eight simulated nodes, 30 days of traffic and an enrollment token for **DE-FRA-01** (printed) to attach a real or dry-run agent. The seed refuses to run with `NODE_ENV=production`.

### 6. Start the API · 7. Start the web apps

```bash
pnpm dev            # API :4000, worker, scheduler, web :3000, admin :3001/admin
pnpm demo:fleet     # optional: heartbeats for the simulated nodes
```

Run the node agent locally without WireGuard (dry run):

```bash
pnpm --filter @stormvpn/node-agent build
STORMVPN_API_URL=http://localhost:4000 AGENT_ALLOW_INSECURE_HTTP=true AGENT_DRY_RUN=true \
STORMVPN_ENROLLMENT_TOKEN=<token printed by the seed> STORMVPN_STATE_DIR=./.agent-state \
node services/node-agent/dist/stormvpn-agent.mjs run
```

### Tests

```bash
pnpm lint && pnpm typecheck
pnpm test                                   # unit tests
TEST_DATABASE_URL=postgresql://stormvpn:stormvpn_dev_password@localhost:5432/stormvpn_test \
TEST_REDIS_URL=redis://localhost:6379/15 pnpm test:integration
```

The integration suite migrates the test database, truncates all tables between tests and uses Redis DB 15.

## Full stack with Docker Compose

```bash
docker compose up -d --build                     # postgres, redis, mailpit, migrate, api, worker, scheduler, web, admin, nginx
docker compose run --rm migrate pnpm run seed    # optional demo data
docker compose --profile monitoring up -d        # Prometheus :9090, Grafana :3002
```

Open http://localhost:8080 (admin under `/admin`, mail UI http://localhost:8025). The `migrate` service runs `prisma migrate deploy` before API/worker/scheduler start.

## One-command install (single VPS)

Platform + first WireGuard node on one fresh Ubuntu 22.04/24.04 or Debian 12 server (≥ 2 GB RAM, public IPv4, open ports TCP 80/443 and UDP 51820):

```bash
curl -fsSL https://raw.githubusercontent.com/StormX1337/StormVPN/claude/vibrant-clarke-kuqenv/install.sh | sudo bash
```

Installs Docker, generates secrets, gets a Let's Encrypt certificate (own domain via `DOMAIN=vpn.example.com`, otherwise `<ip>.sslip.io`), builds and starts all services, creates the plans and the admin account and registers this host as a VPN node. Credentials end up in `/root/stormvpn-credentials.txt`. Options (SMTP, Stripe, `SKIP_NODE=1`, …) are listed at the top of [`install.sh`](install.sh); re-running it updates the installation.

## 12. Production deployment (Ubuntu 24.04 / Debian 12)

### Reference topology

```
Cloudflare (optional, proxied DNS, WAF)
      │ 443
   Nginx (TLS) ──► web (3000) · admin (3001) · api (4000, /api + /api/v1/ws)
                          api/worker/scheduler ──► PostgreSQL 16 (managed or dedicated, backups + PITR)
                                                ──► Redis 7 (AOF, noeviction)
VPN nodes (separate hosts) ──HTTPS──► api
```

### Host preparation

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl ufw fail2ban unattended-upgrades
curl -fsSL https://get.docker.com | sh
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
adduser --system --group stormvpn && usermod -aG docker stormvpn
```

### Configuration

1. Copy the repository (or only `docker-compose.yml`, `infra/`) to `/opt/stormvpn`.
2. Create `/opt/stormvpn/.env` from `.env.example` with production values:
   - `NODE_ENV=production`, `COOKIE_SECURE=true`, `LOG_PRETTY=false`
   - `PUBLIC_URL=https://stormvpn.example` (used for `APP_URL`, `ADMIN_URL`, `CORS_ORIGINS`)
   - strong `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` (≥ 48 random bytes), `DATA_ENCRYPTION_KEY` (32 bytes)
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`), `MAIL_FROM`
   - `METRICS_TOKEN` (Prometheus bearer token), `TRUST_PROXY=uniquelocal` (Docker network)
   - `chmod 600 .env`
3. TLS: obtain certificates (`certbot certonly --webroot -w /var/www/certbot -d stormvpn.example`) and mount `infra/nginx/production/stormvpn.conf` instead of `infra/nginx/conf.d/stormvpn.conf` (replace the domain). Behind Cloudflare use "Full (strict)" and enable `snippets/cloudflare-realip.conf`.
4. Remove development-only services/ports in a `docker-compose.override.yml` (e.g. `mailpit`, database/redis port mappings) or use managed PostgreSQL/Redis by pointing `DATABASE_URL`/`REDIS_URL` to them.

### Build, migrate, run

```bash
cd /opt/stormvpn
docker compose build            # or pull pre-built images from your registry
docker compose up -d
docker compose logs -f api
```

Rolling upgrade:

```bash
git pull && docker compose build
docker compose run --rm migrate               # forward-only migrations
docker compose up -d --no-deps api worker scheduler web admin
```

Migrations are expand/contract compatible: deploy migrations that only add first, ship code, remove old columns in a later release.

### First admin

The seed is for development. In production create the first account via the web registration, then promote it:

```bash
docker compose exec postgres psql -U stormvpn -d stormvpn -c "UPDATE users SET role='ADMIN' WHERE email='you@example.com';"
```

Enable 2FA for every staff account and consider restricting `/admin` with `snippets/admin-allowlist.conf`.

### Backups & monitoring

- PostgreSQL: daily `pg_dump` (or managed PITR) to encrypted off-site storage; test restores regularly.
- Redis holds only transient state (queues, caches) – AOF is enabled; losing it only resets rate limits/sessions caches.
- `docker compose --profile monitoring up -d` → Grafana dashboard _StormVPN – Platform overview_; alerts in `infra/monitoring/prometheus/alerts.yml` (wire Alertmanager to your paging tool).

### Kubernetes

All services are Kubernetes-ready: stateless, configured by environment, graceful `SIGTERM` handling, non-root images, probes:

| Deployment  | Port        | Liveness / readiness             |
| ----------- | ----------- | -------------------------------- |
| api         | 4000        | `/health/live` / `/health/ready` |
| worker      | 4100        | `/health`                        |
| scheduler   | 4200        | `/health`                        |
| web / admin | 3000 / 3001 | `/` / `/admin/login`             |

Run `migrate` as a Job (or Helm pre-upgrade hook) with the `migrator` image target; use an Ingress with WebSocket support for `/api/v1/ws`; store secrets in `Secret` objects or an external secret operator; scale `api` and `worker` with HPA on CPU/RPS.

## Environment variables

See [`.env.example`](../.env.example) – every variable is documented there and validated at startup by `packages/config/src/schemas.ts`. The node agent's variables are listed in [NODE-SETUP.md](NODE-SETUP.md#agent-configuration).
