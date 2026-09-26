# WireGuard in StormVPN

## Keys

| Key                  | Generated where                                                       | Stored where                                                                                                                     |
| -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node private key     | On the node (`@stormvpn/crypto`, clamped Curve25519)                  | `/var/lib/stormvpn-agent/server.key` (0600) – never transmitted                                                                  |
| Node public key      | Derived on the node                                                   | `vpn_nodes.wireguardPublicKey` (sent at registration)                                                                            |
| Client private key   | **On the client** (browser via WebCrypto + noble x25519, native apps) | Only in the user's config file / OS keychain                                                                                     |
| Client public key    | Client                                                                | `vpn_peers.publicKey`                                                                                                            |
| Pre-shared key (PSK) | API (256 bit, `generatePresharedKey`)                                 | `vpn_peers.presharedKeyEnc` – AES-256-GCM, AAD = `psk:<serverId>:<publicKey>`; decrypted only to deliver it to the node over TLS |

If an API client cannot generate keys it may omit `publicKey`; the API then generates a pair, returns the private key **once** inside the config and does not persist it.

Keys are validated as canonical base64 of 32 bytes (`isValidWireGuardKey`). A public key can be registered only once per server.

## Peers

A peer is one **device on one server** (`unique(deviceId, serverId)`). Requesting a config again for the same device/server with a new public key _rekeys_ the peer (new PSK, same addresses); with the same key it returns the existing peer.

Peer states:

| Status     | Reason                                                              | Effect                                                                                         |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ACTIVE`   | –                                                                   | Present on the node                                                                            |
| `DISABLED` | `SUSPENDED`, `NO_SUBSCRIPTION`, `TRAFFIC_LIMIT`, `PLAN_RESTRICTION` | Removed from the node; restored automatically when the condition clears (`reconcileUserPeers`) |
| `DISABLED` | `ADMIN`                                                             | Removed until an admin re-enables it                                                           |
| deleted    | device removed / user revoked the config                            | Removed from the node                                                                          |

## Addressing

- Each server has its own client subnet (`wgSubnetV4`, default `/20`) and optional ULA IPv6 subnet (`wgSubnetV6`, `/64`).
- Gateway = first host (`10.80.0.1/20`) – also the DNS resolver address.
- Peers get the lowest free host (`10.80.0.2`, `.3`, …), network/gateway/broadcast are reserved. Allocation is protected by `unique(serverId, ipv4Address)` and retried on races.
- The IPv6 address mirrors the IPv4 host index (`10.80.1.2` → `fd80:1::102`).
- Subnets must not overlap between servers (validated on create/update) and cannot change while peers exist.

## Client configuration

```ini
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.80.0.2/32, fd80:1::2/128
DNS = 10.80.0.1, fd80:1::1

[Peer]
PublicKey = SERVER_PUBLIC_KEY
PresharedKey = PER_PEER_PSK
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = SERVER_IP:51820
PersistentKeepalive = 25
```

| Setting               | Source                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `Address`             | Allocated peer IPv4 (/32) + IPv6 (/128)                                                       |
| `DNS`                 | Server override → admin setting _Fallback DNS_ → node gateway (Unbound, no logs)              |
| `AllowedIPs`          | Request `allowedIps` (split tunnelling) → `WG_DEFAULT_ALLOWED_IPS` (full tunnel, IPv4 + IPv6) |
| `Endpoint`            | Server `publicIpv4:wireguardPort` (IPv6 literals are bracketed)                               |
| `PersistentKeepalive` | `WG_DEFAULT_KEEPALIVE` (25 s – keeps NAT mappings and lets the node detect liveness)          |

Rendering (`renderWireGuardConfig`) rejects newlines/brackets in any value to prevent config injection. The web UI shows the config once, offers a download (`stormvpn-<server>.conf`) and a QR code for mobile import.

## Node synchronisation

1. Any peer change bumps `vpn_servers.peerRevision` in the same transaction.
2. The heartbeat response carries `desiredRevision`; if it differs from the applied revision the agent calls `GET /agent/config` (ETag `rev-N`).
3. The agent renders `[Interface]` + all active `[Peer]`s and runs `wg syncconf wg0 <file>` (file 0600, deleted afterwards). `syncconf` only adds/removes differences – established sessions survive.
4. The next heartbeat reports `appliedRevision`; the admin panel shows _In sync_/_Pending_.

Kill switch, server `DISABLED`, suspended users and deleted accounts all produce an empty/filtered peer list.

## Telemetry

The agent parses `wg show wg0 dump`, converts cumulative counters to deltas (handling counter resets when peers are re-added) and reports only peers with traffic or a handshake younger than 180 s. The API updates peer counters, daily traffic per user/server and connection states (`CONNECTING → CONNECTED`, config-file sessions). Failed reports are retried with the same deltas.

## MTU, IPv6, performance

- Default WireGuard MTU (1420) works on most links; nftables clamps TCP MSS to the route MTU on the node to avoid black holes.
- IPv6 is always routed into the tunnel (`::/0`), so clients without IPv6 support on the node still don't leak v6 traffic.
- BBR congestion control and larger socket buffers are enabled by the node sysctl profile.

## Client hardening (kill switch & DNS leak protection)

| Platform                | Kill switch                                                                                             | DNS                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Windows (WireGuard app) | "Block untunneled traffic (kill-switch)" – enabled automatically when `AllowedIPs` contains `0.0.0.0/0` | DNS from the config is enforced                   |
| macOS / iOS             | On-Demand rules; future StormVPN app: `includeAllNetworks`                                              | Config DNS                                        |
| Android                 | System settings → VPN → Always-on + "Block connections without VPN"                                     | Config DNS; disable Private DNS for full coverage |
| Linux                   | `wg-quick` full-tunnel uses policy routing; add nftables drop rule for non-wg egress                    | `resolvconf`/`systemd-resolved` via `DNS =`       |

The future native StormVPN clients implement these through the platform WireGuard APIs – see [ARCHITECTURE.md](ARCHITECTURE.md#future-clients-windows-macos-linux-android-ios).
