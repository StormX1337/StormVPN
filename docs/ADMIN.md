# Admin panel

The admin panel is a separate Next.js app served under `/admin` (same origin as the API, so the session cookie is shared). Only users with role **ADMIN** or **SUPPORT** can use it:

| Role      | Access                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `ADMIN`   | Everything                                                              |
| `SUPPORT` | Read-only (all `GET` endpoints); every mutation returns `403 read_only` |
| `USER`    | No access                                                               |

Every mutation is written to the **audit log** (actor, action, target, metadata, IP). Staff should enable 2FA; restrict `/admin` at Nginx with `snippets/admin-allowlist.conf` if possible.

## Pages

| Route                  | Purpose                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`               | Live overview (WebSocket, 5 s): online nodes, active users, active VPN connections, traffic today, API requests and errors today, 30-day traffic chart, traffic by server, node table           |
| `/admin/users`         | Search/filter users; _Manage_: suspend (reason) / unsuspend, change role, revoke sessions, terminate connections, grant complimentary plan (days), subscriptions, peers, recent security events |
| `/admin/subscriptions` | All subscriptions with status/provider/period; cancel, re-sync from Stripe                                                                                                                      |
| `/admin/payments`      | Payments from Stripe webhooks incl. failure reasons                                                                                                                                             |
| `/admin/servers`       | Server catalogue: create/edit, status (active / maintenance / disabled), **enrollment tokens** with install command, **kill switch**, delete (archived when history exists)                     |
| `/admin/nodes`         | Agents: status, load, CPU/RAM/disk, bandwidth, peers, sync state, version, heartbeat; detail with health checks and 24 h CPU/memory history; deregister                                         |
| `/admin/connections`   | Live sessions across the fleet (auto refresh); terminate                                                                                                                                        |
| `/admin/traffic`       | Date presets (today, 7, 30, 90 days): totals, daily chart, by server, top accounts (fair-use review)                                                                                            |
| `/admin/plans`         | Create/edit plans (price, interval, trial, devices, simultaneous sessions, monthly traffic, allowed countries, server classes, priority, features, visibility); deactivate                      |
| `/admin/coupons`       | Percent/amount coupons (once, repeating, forever), max redemptions, expiry; activate/deactivate (synced to Stripe)                                                                              |
| `/admin/logs`          | Audit log with action filter                                                                                                                                                                    |
| `/admin/security`      | Security events (filter by type/severity, resolve) and risk flags (create for IP/user with score + expiry, resolve)                                                                             |
| `/admin/settings`      | Maintenance mode + message, registrations on/off, fallback DNS, auto-suspend score, config generations per hour, overload threshold                                                             |

## Common tasks

**Add a VPN location** – Servers → _Add server_ → _Enrollment token_ → run the installer on the host ([NODE-SETUP.md](NODE-SETUP.md)) → Nodes shows the node `ONLINE`.

**Take a node out of rotation** – Servers → _Maintenance_. Quick Connect stops assigning it immediately; existing tunnels keep working. Back with _Activate_.

**Incident on a node (abuse, compromise)** – Servers → _Kill switch_ with a reason. The node drops every peer on its next sync, sessions end, and it receives no new users until released. The action creates a `SERVER_KILL_SWITCH` security event.

**Platform maintenance** – Settings → _Maintenance mode_ with a message. Customers cannot create new connections; staff can.

**Abuse report for an account** – Users → _Manage_ → review security events/peers → _Suspend_ with the reason. Suspension revokes all sessions, ends connections and disables every peer. Add a risk flag for the source IP to block new registrations.

**Change prices** – Plans → _Edit_ → new price. A new Stripe price is created; existing subscribers keep theirs.

**Comp a customer** – Users → _Manage_ → _Grant complimentary plan_ (optionally time-limited). Not possible while a Stripe subscription is active.

## Automation

- The `abuse-scan` job suspends accounts whose risk score reaches the configured threshold (never staff accounts) and logs `ABUSE_SUSPECTED` + `user.suspend` (actor `SYSTEM`).
- `traffic-enforcement` disables peers of users over their monthly allowance and restores them after the reset or an upgrade.
- `node-health` marks nodes without heartbeats `OFFLINE`; the admin views already show stale nodes as offline.
