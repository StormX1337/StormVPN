# Security

Security is the primary design constraint of StormVPN. This document lists the threat model and every control, with pointers to the implementation.

## Threat model (summary)

| Asset             | Threats                                                    | Primary controls                                                                                                                          |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Customer accounts | credential stuffing, brute force, session theft, CSRF, XSS | Argon2id, lockout + rate limits, TOTP 2FA, HttpOnly cookies, rotating refresh tokens with reuse detection, CSRF double submit, strict CSP |
| WireGuard keys    | server compromise, database leak                           | Client-side key generation, only public keys stored, PSKs AES-256-GCM encrypted, node private keys never leave nodes                      |
| Node fleet        | rogue node registration, token theft, config injection     | Single-use expiring enrollment tokens, hashed node tokens, HTTPS-only agent, config value sanitisation, kill switch                       |
| Billing           | forged webhooks, replay, double processing                 | Stripe signature verification, idempotency ledger, state re-read from Stripe                                                              |
| Platform          | abuse (spam, attacks via VPN), DoS                         | nftables egress filtering (SMTP, private ranges, client isolation), abuse scoring + auto-suspend, rate limits at Nginx and API            |
| Privacy           | logging of user activity                                   | No destination/DNS logging, volume-only accounting, anonymised proxy logs, short retention                                                |

## Authentication & sessions

- **Passwords**: Argon2id (m = 19 MiB, t = 2, p = 1 – OWASP), NFKC normalised, 12–128 characters, transparent rehash when parameters increase (`packages/crypto/src/node/password.ts`). Unknown users are verified against a dummy hash to equalise timing; login errors are identical for wrong password and unknown email.
- **Access tokens**: HS256 JWT, 15 min TTL, `iss`/`aud`/`typ` checked, carries the session id. Every request validates the session state via a 60 s Redis cache → revocation (logout, password change, suspension, role change) takes effect immediately across all API replicas.
- **Refresh tokens**: 256-bit opaque tokens stored as SHA-256 hashes, rotated on every use. Replaying a rotated token after a 30 s grace window revokes the whole session and records `REFRESH_TOKEN_REUSE` (high risk score).
- **Browser clients** receive tokens only as `HttpOnly` cookies (`Secure` in production, `SameSite=Lax` access / `Strict` refresh scoped to `/api/v1/auth`). A non-sensitive `svpn_session` hint cookie lets page routes redirect without exposing tokens. **Native clients** (`x-stormvpn-client: native`) get tokens in the body for OS keychain storage.
- **2FA**: RFC 6238 TOTP (secret AES-GCM encrypted, replay protection via last used time step), 10 one-time backup codes (hashed), MFA challenge tokens expire after 5 minutes / 5 attempts.
- **Email verification** and **password reset** tokens: 256-bit, hashed, single-use (atomic claim), 24 h / 1 h expiry. Reset revokes all sessions. Forgot-password never reveals whether an account exists.
- **Session management**: users list and revoke sessions; admins revoke all sessions of a user.

## CSRF, CORS, XSS & headers

- **CSRF**: double-submit cookie (`svpn_csrf` + `x-csrf-token` header, constant-time compare) on every unsafe request authenticated by cookies – checked _before_ body validation. Bearer/native requests are exempt (custom headers require a CORS preflight).
- **CORS**: explicit origin allowlist (`CORS_ORIGINS`, `APP_URL`, `ADMIN_URL`), credentials only for those.
- **Headers**: API – `default-src 'none'`, `frame-ancestors 'none'`, HSTS (production), `no-referrer`, `Cache-Control: no-store`. Web/Admin – CSP (`default-src 'self'`, no `unsafe-eval` in production), `X-Frame-Options: DENY`, `Permissions-Policy`, `nosniff`. Nginx adds HSTS + COOP in production.
- **XSS**: React escaping; no `dangerouslySetInnerHTML`; email templates escape all interpolations and only allow `http(s)` links; WireGuard config rendering rejects newline/section injection.
- **Open redirects**: post-login `next` parameter restricted to same-site relative paths.

## Input validation & injection

- All request bodies, params and queries are validated with zod schemas (`packages/validation`) – shared with the frontends.
- Prisma parameterises all queries; raw SQL uses tagged templates only (ESLint forbids `$queryRawUnsafe`/`$executeRawUnsafe` outside the test harness).
- Update schemas never inject defaults (tested) to avoid accidental overwrites.

## Rate limiting & brute force

| Layer           | Limit                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nginx           | `/api/v1/auth/*` 10 req/min/IP (burst 20), `/api/*` 20 req/s/IP (burst 100), 50 concurrent connections/IP                                                       |
| API global      | `RATE_LIMIT_MAX_PER_MINUTE` per IP (Redis, shared by replicas)                                                                                                  |
| API auth routes | `AUTH_RATE_LIMIT_PER_MINUTE` per IP; 429s on auth routes are recorded as security events                                                                        |
| Login           | account lockout after `LOGIN_MAX_FAILURES` within `LOGIN_LOCKOUT_MINUTES`; 50 failures/h per IP                                                                 |
| Registration    | `REGISTRATIONS_PER_IP_PER_DAY`; IPs with risk flags ≥ 50 cannot register                                                                                        |
| Other           | password reset 3/h per email, verification resend 3/h, WireGuard config generation `maxConfigGenerationsPerHour` (setting), node auth failures throttled per IP |

## Secrets management

- No secrets in the repository. `.env.example` documents every variable; `.env`, keys and credential files are git-ignored.
- Environment is validated at startup (`packages/config`): minimum lengths, placeholder detection, 32-byte encryption key, `COOKIE_SECURE=true` enforced in production. Error messages never echo values.
- Logs redact authorization headers, cookies, passwords, tokens, private/pre-shared keys and TOTP data.
- **Field encryption**: `DataEncryptor` (AES-256-GCM, random IV, AAD binding, key id prefix) with rotation via `DATA_ENCRYPTION_KEY_PREVIOUS`.
- In production inject secrets from a secret manager (Docker/Kubernetes secrets, Vault, SOPS). Rotate `JWT_ACCESS_SECRET` (invalidates access tokens only), `DATA_ENCRYPTION_KEY` (with previous key configured), Stripe keys, `METRICS_TOKEN` and node tokens (`POST /agent/rotate-token`, automatic every 30 days).

## Node security

- **Enrollment**: admins issue a per-server enrollment token (single use, 24 h TTL, stored hashed). Registration returns a long-lived node token; only its SHA-256 is stored. Tokens never appear in the frontend except the one-time enrollment dialog.
- **Transport**: agents refuse plain HTTP unless `AGENT_ALLOW_INSECURE_HTTP=true` (development).
- **Keys**: the node generates its WireGuard private key locally (`/var/lib/stormvpn-agent/server.key`, 0600). Only the public key is registered.
- **Config hardening**: the agent refuses unsafe characters in rendered WireGuard configs (defence against a compromised control plane), uses `execFile` (no shell), and writes files with 0600 permissions.
- **Firewall** (`infra/wireguard/nftables-stormvpn.nft`): clients can only reach the node's DNS; client-to-client traffic, private/CGNAT/link-local ranges and outbound SMTP (25) are dropped; the resolver and agent metrics are never exposed on the WAN.
- **systemd hardening**: `NoNewPrivileges`, `ProtectSystem=strict`, restricted capabilities and write paths.
- **Kill switch**: engaging it on a server empties its peer set on the next sync and ends all sessions; the node gets no new users.

## Abuse prevention

- Plan limits: devices, simultaneous connections, monthly traffic (peers disabled when exceeded), countries and server classes.
- Security events feed a risk score (e.g. refresh token reuse 20, MFA failure 3, connection limit hits 3). Admin/automatic **risk flags** add to it; IP flags block registrations.
- The `abuse-scan` job computes scores every 10 minutes and **automatically suspends** accounts above `abuseAutoSuspendScore` (suspension revokes sessions, ends connections and disables peers everywhere). Staff accounts are never auto-suspended.
- Admins can suspend/unsuspend users, terminate connections, disable peers, engage server kill switches and enable global maintenance mode. Every action is written to the append-only audit log.
- StormVPN does **not** implement features to evade other systems' security controls or to facilitate anonymous criminal activity.

## Privacy & data retention

- No logging of visited destinations, DNS queries, client source endpoints or packet contents. The node resolver runs with `log-queries: no`.
- Stored per user: account data, sessions (IP + user agent for account security), devices, peers (public keys, tunnel IPs), session metadata (start/end, byte counts), daily traffic volume per server.
- Retention (worker `cleanup`): revoked sessions 30 d, used tokens 1 d, connection records 30 d, heartbeats 7 d, processed webhooks 90 d, audit logs 365 d.
- Account deletion anonymises the user, removes devices/peers/favourites and keeps invoices/payments for statutory accounting.
- Nginx access logs contain truncated client addresses only.

## Dependency & supply chain

- Lockfile committed; CI installs with `--frozen-lockfile`; only whitelisted packages may run install scripts (`pnpm-workspace.yaml`).
- Container images run as non-root, are built from pruned workspaces, contain only production dependencies.
- Agent releases ship with SHA-256 checksums; the update script verifies checksum and version before swapping atomically.

## Reporting vulnerabilities

Please report security issues privately to `security@stormvpn.example` (replace with your contact). Do not open public issues for vulnerabilities.
