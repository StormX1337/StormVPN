#!/usr/bin/env bash
# StormVPN VPN node installer (Ubuntu 22.04/24.04, Debian 12).
#
#   curl -fsSLO https://<your-host>/install-node.sh
#   sudo STORMVPN_API_URL=https://stormvpn.example \
#        STORMVPN_ENROLLMENT_TOKEN=sne_xxx \
#        STORMVPN_AGENT_URL=https://downloads.stormvpn.example/agent/stormvpn-agent-1.0.0.tar.gz \
#        bash install-node.sh
#
# Idempotent: safe to re-run. Installs WireGuard, nftables NAT/firewall,
# an Unbound resolver without query logging, Node.js 22 and the agent.
set -euo pipefail

: "${STORMVPN_API_URL:?STORMVPN_API_URL is required}"
STORMVPN_ENROLLMENT_TOKEN="${STORMVPN_ENROLLMENT_TOKEN:-}"
STORMVPN_AGENT_URL="${STORMVPN_AGENT_URL:-}"
AGENT_BUNDLE="${AGENT_BUNDLE:-}"
WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_PORT="${WG_PORT:-51820}"
WAN_INTERFACE="${WAN_INTERFACE:-$(ip -4 route show default | awk '{print $5; exit}')}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_HOME=/usr/local/lib/stormvpn-agent

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ -n "$WAN_INTERFACE" ]] || die "could not detect the WAN interface – set WAN_INTERFACE"
[[ "$STORMVPN_API_URL" == https://* || "${AGENT_ALLOW_INSECURE_HTTP:-false}" == "true" ]] || die "STORMVPN_API_URL must use https://"
. /etc/os-release
[[ "$ID" == "ubuntu" || "$ID" == "debian" ]] || die "unsupported distribution: $ID"

# Unbound listens on port 53 – free it from the systemd-resolved stub listener first.
if systemctl is-active --quiet systemd-resolved; then
  log "Disabling the systemd-resolved stub listener (port 53)"
  install -d /etc/systemd/resolved.conf.d
  printf '[Resolve]\nDNSStubListener=no\n' > /etc/systemd/resolved.conf.d/stormvpn.conf
  ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
  systemctl restart systemd-resolved
fi

log "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools nftables unbound curl ca-certificates gnupg iproute2 >/dev/null

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

log "Kernel networking (forwarding, BBR, hardening)"
install -m 0644 "$SCRIPT_DIR/sysctl-stormvpn.conf" /etc/sysctl.d/99-stormvpn.conf
sysctl --system >/dev/null

log "Firewall + NAT (nftables) on WAN=$WAN_INTERFACE, WG=$WG_INTERFACE"
install -d /etc/nftables.d
sed -e "s/@WAN_IF@/${WAN_INTERFACE}/g" -e "s/@WG_IF@/${WG_INTERFACE}/g" -e "s/@WG_PORT@/${WG_PORT}/g" \
  "$SCRIPT_DIR/nftables-stormvpn.nft" > /etc/nftables.d/stormvpn.nft
grep -q 'include "/etc/nftables.d/\*.nft"' /etc/nftables.conf || echo 'include "/etc/nftables.d/*.nft"' >> /etc/nftables.conf
nft -c -f /etc/nftables.conf
# Load only our table: reloading nftables.conf ("flush ruleset") would drop Docker's rules.
nft -f /etc/nftables.d/stormvpn.nft
systemctl enable nftables >/dev/null

if command -v docker >/dev/null; then
  # Docker sets the iptables FORWARD policy to DROP – allow tunnel traffic via DOCKER-USER.
  log "Allowing WireGuard forwarding next to Docker"
  cat > /usr/local/sbin/stormvpn-docker-forward.sh <<SH
#!/bin/sh
for ipt in iptables ip6tables; do
  \$ipt -C DOCKER-USER -i ${WG_INTERFACE} -j ACCEPT 2>/dev/null || \$ipt -I DOCKER-USER -i ${WG_INTERFACE} -j ACCEPT 2>/dev/null
  \$ipt -C DOCKER-USER -o ${WG_INTERFACE} -j ACCEPT 2>/dev/null || \$ipt -I DOCKER-USER -o ${WG_INTERFACE} -j ACCEPT 2>/dev/null
done
exit 0
SH
  chmod 0755 /usr/local/sbin/stormvpn-docker-forward.sh
  cat > /etc/systemd/system/stormvpn-docker-forward.service <<UNIT
[Unit]
Description=StormVPN: allow WireGuard forwarding with Docker
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/stormvpn-docker-forward.sh

[Install]
WantedBy=docker.service
UNIT
  systemctl daemon-reload
  systemctl enable stormvpn-docker-forward >/dev/null
  systemctl restart stormvpn-docker-forward
fi

log "DNS resolver (Unbound, no query logs)"
install -m 0644 "$SCRIPT_DIR/unbound-stormvpn.conf" /etc/unbound/unbound.conf.d/stormvpn.conf
unbound-checkconf >/dev/null
systemctl enable --now unbound >/dev/null
systemctl restart unbound

log "Installing StormVPN agent"
install -d -m 0755 "$AGENT_HOME"
install -d -m 0700 /var/lib/stormvpn-agent /etc/stormvpn-agent
if [[ -n "$AGENT_BUNDLE" ]]; then
  install -m 0755 "$AGENT_BUNDLE" "$AGENT_HOME/stormvpn-agent.mjs"
elif [[ -n "$STORMVPN_AGENT_URL" ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL "$STORMVPN_AGENT_URL" -o "$tmp/agent.tar.gz"
  curl -fsSL "$STORMVPN_AGENT_URL.sha256" -o "$tmp/agent.tar.gz.sha256"
  (cd "$tmp" && echo "$(cut -d' ' -f1 agent.tar.gz.sha256)  agent.tar.gz" | sha256sum -c --quiet) || die "agent checksum mismatch"
  tar -xzf "$tmp/agent.tar.gz" -C "$tmp"
  install -m 0755 "$tmp/stormvpn-agent.mjs" "$AGENT_HOME/stormvpn-agent.mjs"
  rm -rf "$tmp"
else
  die "set STORMVPN_AGENT_URL (release tarball) or AGENT_BUNDLE (local stormvpn-agent.mjs)"
fi
install -m 0755 "$SCRIPT_DIR/update-agent.sh" "$AGENT_HOME/update.sh"
ln -sf "$AGENT_HOME/stormvpn-agent.mjs" /usr/local/bin/stormvpn-agent

if [[ ! -f /etc/stormvpn-agent/agent.env ]]; then
  umask 077
  cat > /etc/stormvpn-agent/agent.env <<ENV
STORMVPN_API_URL=${STORMVPN_API_URL}
STORMVPN_ENROLLMENT_TOKEN=${STORMVPN_ENROLLMENT_TOKEN}
WG_INTERFACE=${WG_INTERFACE}
WAN_INTERFACE=${WAN_INTERFACE}
METRICS_HOST=127.0.0.1
METRICS_PORT=9586
AGENT_AUTO_UPDATE=false
LOG_LEVEL=info
ENV
fi
install -m 0644 "$SCRIPT_DIR/stormvpn-agent.service" /etc/systemd/system/stormvpn-agent.service
systemctl daemon-reload

if [[ ! -f /var/lib/stormvpn-agent/credentials.json ]]; then
  [[ -n "$STORMVPN_ENROLLMENT_TOKEN" ]] || die "STORMVPN_ENROLLMENT_TOKEN is required for the first registration"
  log "Registering node"
  set -a; . /etc/stormvpn-agent/agent.env; set +a
  node "$AGENT_HOME/stormvpn-agent.mjs" register
  # The enrollment token is single-use – remove it from disk.
  sed -i '/^STORMVPN_ENROLLMENT_TOKEN=/d' /etc/stormvpn-agent/agent.env
fi

systemctl enable --now stormvpn-agent >/dev/null
systemctl restart stormvpn-agent
log "Done. Status: systemctl status stormvpn-agent · journalctl -u stormvpn-agent -f"
