#!/usr/bin/env bash
# Agent self-update hook (invoked by the agent when AGENT_AUTO_UPDATE=true).
#   update.sh <version> <tarball-url>
# Downloads the release, verifies its SHA-256 checksum (<url>.sha256),
# swaps the bundle atomically and restarts the service. Rolls back on failure.
set -euo pipefail
VERSION="${1:?version required}"
URL="${2:?url required}"
HOME_DIR=/usr/local/lib/stormvpn-agent
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ "$URL" == https://* ]] || { echo "refusing non-https update URL" >&2; exit 1; }
curl -fsSL "$URL" -o "$TMP/agent.tar.gz"
curl -fsSL "$URL.sha256" -o "$TMP/agent.tar.gz.sha256"
(cd "$TMP" && echo "$(cut -d' ' -f1 agent.tar.gz.sha256)  agent.tar.gz" | sha256sum -c --quiet)
tar -xzf "$TMP/agent.tar.gz" -C "$TMP"
[[ "$(node "$TMP/stormvpn-agent.mjs" version)" == "$VERSION" ]] || { echo "version mismatch" >&2; exit 1; }

cp "$HOME_DIR/stormvpn-agent.mjs" "$HOME_DIR/stormvpn-agent.mjs.previous"
install -m 0755 "$TMP/stormvpn-agent.mjs" "$HOME_DIR/stormvpn-agent.mjs.new"
mv -f "$HOME_DIR/stormvpn-agent.mjs.new" "$HOME_DIR/stormvpn-agent.mjs"
# Restart asynchronously so the running agent can exit cleanly.
systemd-run --on-active=2 --unit="stormvpn-agent-update-$VERSION" /bin/systemctl restart stormvpn-agent
echo "stormvpn-agent updated to $VERSION"
