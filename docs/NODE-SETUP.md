# VPN node setup

Every VPN server (e.g. `DE-FRA-01`) is a Linux host running WireGuard, nftables NAT, an Unbound resolver and the **StormVPN node agent**. The agent registers itself with an enrollment token, reports heartbeats every 15 seconds and keeps the kernel's WireGuard peer table in sync with the control plane.

```
Internet ──UDP 51820──► wg0 (WireGuard) ──► nftables forward/NAT ──► WAN ──► Internet
                              ▲
             stormvpn-agent ──┘ (wg syncconf)  ──HTTPS──► StormVPN API
```

## Requirements

- Ubuntu 22.04/24.04 or Debian 12, kernel ≥ 5.6 (WireGuard in-kernel), x86_64 or arm64
- Public IPv4 (IPv6 optional), UDP port 51820 reachable
- 1 vCPU / 1 GB RAM minimum; size bandwidth to `bandwidthCapacityMbps`
- Outbound HTTPS to the StormVPN API

## 8. Install a VPN node

### a) Create the server in the admin panel

Admin → **Servers** → _Add server_:

| Field                       | Example                            | Notes                                                 |
| --------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Name                        | `DE-FRA-03`                        | Format `CC-CITY-NN`                                   |
| Hostname                    | `de-fra-03.nodes.stormvpn.example` |                                                       |
| Country / City / Region     | `DE` / Frankfurt / EUROPE          | Used for Quick Connect and plan restrictions          |
| Public IPv4/IPv6            | `203.0.113.23`                     | Endpoint written into client configs                  |
| WireGuard port              | `51820`                            |                                                       |
| Class                       | STANDARD / PREMIUM / STREAMING     | Plans allow classes                                   |
| Max connections / bandwidth | `500` / `10000`                    | Load calculation                                      |
| Client subnet               | `10.80.32.0/20`                    | **Must be unique per server** (overlaps are rejected) |
| IPv6 subnet                 | `fd80:3::/64`                      | Optional                                              |

### b) Issue an enrollment token

Servers → ⋯ → **Enrollment token**. The dialog shows a single-use token (valid 24 h) and the install command.

### c) Run the installer on the host

```bash
# Build/publish the agent once (CI does this as an artifact):
scripts/package-agent.sh            # → dist/agent/stormvpn-agent-1.0.0.tar.gz (+ .sha256) and install-node.sh

# On the VPN host (as root), with the files from infra/wireguard/ next to install-node.sh:
STORMVPN_API_URL=https://stormvpn.example \
STORMVPN_ENROLLMENT_TOKEN=sne_xxxxxxxx \
STORMVPN_AGENT_URL=https://downloads.stormvpn.example/agent/stormvpn-agent-1.0.0.tar.gz \
bash install-node.sh
# or AGENT_BUNDLE=/root/stormvpn-agent.mjs instead of STORMVPN_AGENT_URL
```

The installer (idempotent):

1. installs `wireguard-tools`, `nftables`, `unbound`, Node.js 22;
2. applies kernel settings (`/etc/sysctl.d/99-stormvpn.conf`: forwarding, BBR, hardening);
3. installs the firewall/NAT ruleset (`/etc/nftables.d/stormvpn.nft`) for the detected WAN interface;
4. configures Unbound as a recursive resolver **without query logging**, reachable only from the tunnel;
5. installs the agent to `/usr/local/lib/stormvpn-agent/`, writes `/etc/stormvpn-agent/agent.env` (0600) and the systemd unit;
6. registers the node (`stormvpn-agent register`) and wipes the single-use enrollment token from disk;
7. starts `stormvpn-agent.service`.

## 9. Register the node / verify

```bash
systemctl status stormvpn-agent
journalctl -u stormvpn-agent -f         # "node registered", "WireGuard configuration applied"
stormvpn-agent status                   # JSON: registration, WireGuard state
wg show wg0                             # peers appear as customers connect
curl -s 127.0.0.1:9586/metrics | head   # local Prometheus metrics
```

In the admin panel the node appears under **Nodes** as `ONLINE` with CPU/RAM/disk/bandwidth, health checks (WireGuard, IP forwarding, NAT) and _Peer sync: In sync_. A node with failing health checks is `DEGRADED` and receives no new users while healthy nodes exist; without heartbeats for 90 s it becomes `OFFLINE`.

## 10. WireGuard configuration on the node

The agent owns `/etc/wireguard/wg0.conf` (interface only: address = first host of the client subnet, listen port, private key) and brings the interface up with `wg-quick`. Peers are never written to disk: on every revision change the agent renders the complete desired state and applies it atomically with `wg syncconf` (existing sessions of unchanged peers are kept). See [WIREGUARD.md](WIREGUARD.md).

## Agent configuration

`/etc/stormvpn-agent/agent.env`:

| Variable                                            | Default                                             | Description                                                               |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `STORMVPN_API_URL`                                  | –                                                   | Control plane URL (https required)                                        |
| `STORMVPN_ENROLLMENT_TOKEN`                         | –                                                   | Only for the first registration                                           |
| `STORMVPN_STATE_DIR`                                | `/var/lib/stormvpn-agent`                           | Credentials + server key (0700/0600)                                      |
| `WG_INTERFACE` / `WG_CONFIG_DIR`                    | `wg0` / `/etc/wireguard`                            |                                                                           |
| `WAN_INTERFACE`                                     | auto (default route)                                | NAT + bandwidth metrics                                                   |
| `PUBLIC_IPV4` / `PUBLIC_IPV6`                       | auto                                                | Override public IP detection                                              |
| `PUBLIC_IP_ECHO_URLS`                               | ipify, icanhazip                                    | HTTPS echo services for detection                                         |
| `METRICS_ENABLED` / `METRICS_HOST` / `METRICS_PORT` | `true` / `127.0.0.1` / `9586`                       | Prometheus endpoint (bind to a private management IP to scrape centrally) |
| `AGENT_AUTO_UPDATE` / `AGENT_UPDATE_COMMAND`        | `false` / `/usr/local/lib/stormvpn-agent/update.sh` | Automatic updates                                                         |
| `TOKEN_ROTATION_DAYS`                               | `30`                                                | Automatic node token rotation                                             |
| `HTTP_TIMEOUT_MS`                                   | `10000`                                             | API timeout (with retry + backoff)                                        |
| `AGENT_DRY_RUN`                                     | `false`                                             | Simulated WireGuard for development                                       |
| `AGENT_ALLOW_INSECURE_HTTP`                         | `false`                                             | Allow `http://` API URLs (development only)                               |

## Running the agent in Docker

```bash
docker run -d --name stormvpn-agent --restart unless-stopped \
  --network host --cap-add NET_ADMIN --cap-add SYS_MODULE \
  -v /etc/wireguard:/etc/wireguard -v /var/lib/stormvpn-agent:/var/lib/stormvpn-agent \
  -e STORMVPN_API_URL=https://stormvpn.example -e STORMVPN_ENROLLMENT_TOKEN=sne_xxx \
  stormvpn/node-agent:latest
```

Firewall, sysctl and Unbound still have to be applied on the host (steps 2–4 of the installer).

## Operations

- **Maintenance**: Admin → Servers → _Maintenance_. The node reports `MAINTENANCE`, no new users are assigned; existing tunnels continue.
- **Kill switch**: Admin → Servers → _Kill switch_ (reason required). All peers are removed from the node within one heartbeat and all sessions end.
- **Replace a host**: deregister the node (Nodes → _Deregister_), issue a new enrollment token and install on the new host. If you keep `/var/lib/stormvpn-agent/server.key`, existing client configs remain valid.
- **Updates**: set `AGENT_LATEST_VERSION` + `AGENT_UPDATE_BASE_URL` on the API; with `AGENT_AUTO_UPDATE=true` agents download `stormvpn-agent-<version>.tar.gz`, verify `.sha256`, swap atomically and restart. Otherwise they log "agent update available".
- **Monitoring**: add node management IPs to `infra/monitoring/prometheus/targets/nodes.json`.

## Troubleshooting

| Symptom                         | Check                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Node `OFFLINE`                  | `journalctl -u stormvpn-agent`, outbound HTTPS, clock sync (`timedatectl`), token (401 → re-enroll)         |
| Node `DEGRADED`                 | Health checks in Admin → Nodes → node: `ip_forward`, NAT (`nft list ruleset \| grep masquerade`), `wg show` |
| Clients connect but no internet | NAT/forward chain uses the right `WAN_INTERFACE`; provider firewall; `sysctl net.ipv4.ip_forward`           |
| DNS fails in tunnel             | `systemctl status unbound`, firewall allows UDP/TCP 53 on `wg0`                                             |
| Handshake never happens         | UDP 51820 open at the provider/security group; correct public IP in the server entry                        |

## Manual end-to-end verification

1. Admin: server exists, node `ONLINE`, _In sync_.
2. Customer: Devices → _Get config_ for the server → import into the WireGuard app → activate.
3. On the node: `wg show wg0` shows the peer with a recent handshake and transfer counters.
4. Customer dashboard switches to **Protected**; `curl https://api.ipify.org` in the tunnel returns the node's public IP.
5. Admin → Connections shows the session; Traffic grows after the next heartbeats.
