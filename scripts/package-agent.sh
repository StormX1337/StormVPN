#!/usr/bin/env bash
# Builds the single-file node agent and a release tarball + SHA-256 checksum.
#   scripts/package-agent.sh   → dist/agent/stormvpn-agent-<version>.tar.gz(.sha256)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm turbo run build --filter=@stormvpn/node-agent...
VERSION="$(node services/node-agent/dist/stormvpn-agent.mjs version)"
OUT="$ROOT/dist/agent"
mkdir -p "$OUT"
tar -czf "$OUT/stormvpn-agent-$VERSION.tar.gz" -C services/node-agent/dist stormvpn-agent.mjs
(cd "$OUT" && sha256sum "stormvpn-agent-$VERSION.tar.gz" > "stormvpn-agent-$VERSION.tar.gz.sha256")
cp infra/wireguard/install-node.sh "$OUT/"
echo "Packaged agent $VERSION in $OUT"
