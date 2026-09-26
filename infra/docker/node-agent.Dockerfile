# syntax=docker/dockerfile:1.7
# Container image for the StormVPN node agent. Runs on the VPN host with
#   --network host --cap-add NET_ADMIN -v /etc/wireguard:/etc/wireguard
#   -v /var/lib/stormvpn-agent:/var/lib/stormvpn-agent
# (see docs/NODE-SETUP.md). A systemd deployment without Docker is also supported.

ARG BASE_IMAGE=node:22-bookworm-slim

FROM ${BASE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1 CI=true
RUN npm install -g pnpm@10.33.0 turbo@2.11.4
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN turbo prune @stormvpn/node-agent --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN turbo run build --filter="@stormvpn/node-agent..."

FROM ${BASE_IMAGE} AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends wireguard-tools iproute2 nftables iptables procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /repo/services/node-agent/dist/stormvpn-agent.mjs /usr/local/lib/stormvpn-agent/stormvpn-agent.mjs
ENV NODE_ENV=production \
    STORMVPN_STATE_DIR=/var/lib/stormvpn-agent \
    WG_CONFIG_DIR=/etc/wireguard
VOLUME ["/var/lib/stormvpn-agent", "/etc/wireguard"]
ENTRYPOINT ["node", "/usr/local/lib/stormvpn-agent/stormvpn-agent.mjs"]
CMD ["run"]
