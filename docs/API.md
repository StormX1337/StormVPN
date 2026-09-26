# API reference (v1)

Base path: `/api/v1`. JSON only. Timestamps are ISO-8601 UTC. Byte counters are numbers; `rx`/`tx` are **from the server's perspective** (`tx` = download to the client, `rx` = upload from the client).

## Conventions

### Authentication

| Client              | How                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser (web/admin) | HttpOnly cookies `svpn_at` (access, 15 min) and `svpn_rt` (refresh, path `/api/v1/auth`). Unsafe methods require `x-csrf-token` = value of cookie `svpn_csrf` (obtain via `GET /auth/csrf`). |
| Native apps         | Send `x-stormvpn-client: native` on login/refresh to receive tokens in the body, then `Authorization: Bearer <accessToken>`. No CSRF token needed.                                           |
| Node agents         | `Authorization: Bearer snt_…` (node token) on `/agent/*`.                                                                                                                                    |

Access tokens expire after 15 minutes; call `POST /auth/refresh` (cookie or `{ refreshToken }`) – refresh tokens rotate on every use and replaying an old one revokes the session. `@stormvpn/api-client` handles CSRF and refresh automatically.

### Errors

```json
{
  "error": {
    "code": "connection_limit_reached",
    "message": "Your plan allows 2 simultaneous connection(s)",
    "requestId": "…"
  }
}
```

| Status | Typical codes                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` (with `details.issues[]`), `invalid_token`, `invalid_mfa_code`, `invalid_coupon`                               |
| 401    | `unauthorized`, `token_expired`, `session_revoked`, `invalid_credentials`, `invalid_refresh_token`, `node_unauthorized`           |
| 402    | `subscription_required`, `traffic_limit_reached`                                                                                  |
| 403    | `csrf_invalid`, `forbidden`, `read_only`, `account_suspended`, `email_not_verified`, `server_not_in_plan`, `device_limit_reached` |
| 404    | `not_found`, `route_not_found`                                                                                                    |
| 409    | `email_taken`, `connection_limit_reached`, `server_full`, `public_key_in_use`, `subscription_exists`                              |
| 429    | `rate_limited`, `account_locked`, `config_quota_exceeded`, `registration_limit` (+ `Retry-After`)                                 |
| 503    | `maintenance`, `no_server_available`, `server_unavailable`, `billing_unavailable`                                                 |

Every response carries `x-request-id`. Lists that paginate accept `page` (1-based) and `pageSize` (≤ 100) and return `{ items, total, page, pageSize }`.

## Auth

| Method | Path                        | Body                                            | Notes                                                                      |
| ------ | --------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/auth/csrf`                | –                                               | Sets `svpn_csrf`, returns `{ csrfToken }`                                  |
| POST   | `/auth/register`            | `{ email, password, name?, acceptTerms: true }` | 201 `{ user, tokens? }`; starts on the free plan, sends verification email |
| POST   | `/auth/login`               | `{ email, password }`                           | `{ user, tokens? }` or `{ mfaRequired: true, mfaToken }`                   |
| POST   | `/auth/login/mfa`           | `{ mfaToken, code }`                            | TOTP code or backup code                                                   |
| POST   | `/auth/refresh`             | `{ refreshToken? }`                             | Rotates tokens                                                             |
| POST   | `/auth/logout`              | `{ refreshToken? }`                             | 204, revokes the session                                                   |
| POST   | `/auth/verify-email`        | `{ token }`                                     |                                                                            |
| POST   | `/auth/resend-verification` | –                                               | auth required, 3/h                                                         |
| POST   | `/auth/forgot-password`     | `{ email }`                                     | always 202                                                                 |
| POST   | `/auth/reset-password`      | `{ token, password }`                           | revokes all sessions                                                       |

## User & account

| Method | Path                        | Notes                                                                           |
| ------ | --------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/user`                     | Current user                                                                    |
| PATCH  | `/user`                     | `{ name?, preferredCountry?, preferredRegion? }`                                |
| GET    | `/user/ip`                  | `{ ip, country, protected }` (protected = request comes from a StormVPN server) |
| POST   | `/account/password`         | `{ currentPassword, newPassword }` – other sessions are revoked                 |
| POST   | `/account/2fa/setup`        | `{ secret, otpauthUrl }`                                                        |
| POST   | `/account/2fa/enable`       | `{ code }` → `{ backupCodes }`                                                  |
| POST   | `/account/2fa/disable`      | `{ password, code }`                                                            |
| POST   | `/account/2fa/backup-codes` | `{ code }` → new backup codes                                                   |
| GET    | `/account/sessions`         | Active sessions (`current` flag)                                                |
| DELETE | `/account/sessions/:id`     | Revoke one                                                                      |
| DELETE | `/account/sessions`         | Revoke all others                                                               |
| GET    | `/account/security-events`  | Last 50 events                                                                  |
| DELETE | `/account`                  | `{ password, confirm: "DELETE" }` – GDPR deletion                               |

## VPN

| Method       | Path                          | Notes                                                                                                                                                     |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET          | `/servers`                    | Query `country`, `region`, `city`, `serverClass`, `search`, `onlyAvailable`. Returns status, load, capacity, IP, protocol, `allowed` (plan), `isFavorite` |
| GET          | `/servers/recommended`        | Quick Connect preview `{ server, score, reason }`                                                                                                         |
| GET          | `/servers/:id`                |                                                                                                                                                           |
| PUT / DELETE | `/servers/:id/favorite`       |                                                                                                                                                           |
| GET          | `/devices`                    |                                                                                                                                                           |
| POST         | `/devices`                    | `{ name, platform: WINDOWS\|MACOS\|LINUX\|ANDROID\|IOS\|ROUTER\|OTHER, clientVersion? }` (plan device limit)                                              |
| PATCH        | `/devices/:id`                | `{ name }`                                                                                                                                                |
| DELETE       | `/devices/:id`                | Revokes all peers of the device                                                                                                                           |
| GET          | `/devices/:id/peers`          | WireGuard configurations of the device                                                                                                                    |
| DELETE       | `/devices/:id/peers/:peerId`  | Revoke one configuration                                                                                                                                  |
| POST         | `/wireguard/config`           | Generate a config without starting a session (see below)                                                                                                  |
| POST         | `/connections`                | Connect (see below)                                                                                                                                       |
| GET          | `/connections`                | Live sessions                                                                                                                                             |
| GET          | `/connections/status`         | `{ connected, connection, publicIp, killSwitch }`                                                                                                         |
| GET          | `/connections/history?limit=` |                                                                                                                                                           |
| DELETE       | `/connections/:id`            | Disconnect                                                                                                                                                |
| GET          | `/traffic/summary?days=30`    | Month totals, limit, daily series                                                                                                                         |

### `POST /connections` / `POST /wireguard/config`

```json
{
  "deviceId": "0199…",
  "serverId": "0199…", // omit for Quick Connect
  "country": "DE", // optional Quick Connect filters: country, region, city
  "publicKey": "base64 WireGuard public key", // recommended: generated on the client
  "allowedIps": ["0.0.0.0/0", "::/0"], // optional split tunnelling
  "latencies": { "<serverId>": 23 } // optional client-measured RTTs (ms)
}
```

Response (`/connections`, 201):

```json
{
  "connection": { "id": "…", "status": "CONNECTING", "server": { "name": "DE-FRA-02", … }, "assignedIpv4": "10.80.16.2", … },
  "wireguard": {
    "config": "[Interface]\nPrivateKey = __STORMVPN_CLIENT_PRIVATE_KEY__\nAddress = 10.80.16.2/32, fd80:2::2/128\nDNS = 10.80.16.1, fd80:2::1\n\n[Peer]\nPublicKey = …\nPresharedKey = …\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 203.0.113.12:51820\nPersistentKeepalive = 25\n",
    "fileName": "stormvpn-de-fra-02.conf",
    "privateKeyIncluded": false,
    "peer": { "id": "…", "ipv4Address": "10.80.16.2", … },
    "server": { … }
  },
  "selection": { "strategy": "quick", "score": 77.9, "reason": "Lowest combined load/latency score (load 31%, ~11 ms)" }
}
```

Clients replace `__STORMVPN_CLIENT_PRIVATE_KEY__` with their locally generated private key (`injectPrivateKey` in `@stormvpn/crypto`). If `publicKey` is omitted, the server generates a pair and returns the full config once (`privateKeyIncluded: true`); the private key is never stored.

## Billing

| Method | Path                                  | Notes                                                                   |
| ------ | ------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/plans`                              | Public, active plans                                                    |
| GET    | `/subscription`                       | `{ subscription, usage, trialEligible }`                                |
| POST   | `/billing/checkout`                   | `{ planId, couponCode? }` → `{ url }` (Stripe Checkout)                 |
| POST   | `/billing/portal`                     | → `{ url }` (Stripe Customer Portal)                                    |
| POST   | `/billing/change-plan`                | `{ planId }` – prorated upgrade/downgrade (free = cancel at period end) |
| POST   | `/billing/cancel` / `/billing/resume` | Cancel at period end / undo                                             |
| GET    | `/billing/invoices`                   |                                                                         |
| POST   | `/billing/coupons/validate`           | `{ code, planId? }`                                                     |
| POST   | `/billing/webhook`                    | Stripe only (signature verified, idempotent)                            |

## Admin (`/admin`, role ADMIN – SUPPORT has read-only GET access)

| Area            | Endpoints                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stats           | `GET /admin/stats`                                                                                                                                                                                                                                   |
| Users           | `GET /admin/users?search&status&role&page`, `GET /admin/users/:id`, `POST …/:id/suspend {reason}`, `POST …/:id/unsuspend`, `PATCH …/:id/role {role}`, `POST …/:id/sessions/revoke`, `POST …/:id/disconnect`, `POST …/:id/grant-plan {planId, days?}` |
| Subscriptions   | `GET /admin/subscriptions`, `POST …/:id/cancel {immediately}`, `POST …/:id/sync`                                                                                                                                                                     |
| Payments        | `GET /admin/payments`                                                                                                                                                                                                                                |
| Plans           | `GET/POST /admin/plans`, `PATCH/DELETE /admin/plans/:id`                                                                                                                                                                                             |
| Coupons         | `GET/POST /admin/coupons`, `PATCH /admin/coupons/:id`                                                                                                                                                                                                |
| Servers         | `GET/POST /admin/servers`, `GET/PATCH/DELETE /admin/servers/:id`, `POST …/:id/status {status}`, `POST …/:id/kill-switch {engaged, reason}`, `POST …/:id/enrollment-token`                                                                            |
| Nodes           | `GET /admin/nodes`, `GET /admin/nodes/:id` (24 h history), `DELETE /admin/nodes/:id`                                                                                                                                                                 |
| Connections     | `GET /admin/connections?status&serverId&userId`, `DELETE /admin/connections/:id`                                                                                                                                                                     |
| Traffic         | `GET /admin/traffic?from&to`                                                                                                                                                                                                                         |
| Logs & security | `GET /admin/logs`, `GET /admin/security/events`, `POST …/events/:id/resolve`, `GET/POST /admin/security/risk-flags`, `POST …/risk-flags/:id/resolve`                                                                                                 |
| Settings        | `GET/PATCH /admin/settings` (maintenance mode, registration, DNS fallback, abuse thresholds, overload threshold)                                                                                                                                     |

## Node agent (`/agent`)

| Method | Path                  | Auth                     | Notes                                                                                                                                                                               |
| ------ | --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/agent/register`     | enrollment token in body | `{ enrollmentToken, hostname, agentVersion, wireguardPublicKey, publicIpv4?, publicIpv6?, os?, kernel? }` → `{ nodeId, serverId, serverName, nodeToken, heartbeatIntervalSeconds }` |
| POST   | `/agent/heartbeat`    | node token               | metrics, WireGuard state, health checks, per-peer stat deltas → `{ desiredRevision, heartbeatIntervalSeconds, maintenance, killSwitch, desiredAgentVersion, updateUrl }`            |
| GET    | `/agent/config`       | node token               | `If-None-Match: "rev-N"` → 304 or `{ revision, interface, peers[] }`                                                                                                                |
| POST   | `/agent/rotate-token` | node token               | → `{ nodeToken }`                                                                                                                                                                   |

## WebSocket `/api/v1/ws`

Authenticated like REST (cookie or bearer). Client → server: `{"type":"ping"}`. Server → client:

| Type                 | Audience          | Data                  |
| -------------------- | ----------------- | --------------------- |
| `hello`              | all               | `{ userId, admin }`   |
| `connection.updated` | owner             | `ConnectionDto`       |
| `account.suspended`  | owner             | `{ reason }`          |
| `admin.stats`        | staff (every 5 s) | `AdminStatsDto`       |
| `admin.node`         | staff             | node status + metrics |
| `pong`               | all               | `{ ts }`              |

## Health & metrics

- `GET /health/live` – process up; `GET /health/ready` – PostgreSQL + Redis reachable.
- `GET /metrics` – Prometheus format; requires `Authorization: Bearer $METRICS_TOKEN` when set, otherwise private networks only. Blocked at Nginx.
