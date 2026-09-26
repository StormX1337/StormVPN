# syntax=docker/dockerfile:1.7
# Builds a Node.js service of the monorepo (api, worker, scheduler) into a
# minimal non-root runtime image.
#
#   docker build -f infra/docker/node-service.Dockerfile \
#     --build-arg PACKAGE=@stormvpn/api --build-arg PORT=4000 -t stormvpn/api .
#
# Targets: `runner` (default runtime), `migrator` (prisma migrate deploy / seed).

ARG BASE_IMAGE=node:22-bookworm-slim

FROM ${BASE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
RUN npm install -g pnpm@10.33.0 turbo@2.11.4
WORKDIR /repo

FROM base AS pruner
ARG PACKAGE
COPY . .
RUN turbo prune "${PACKAGE}" --docker

FROM base AS builder
ARG PACKAGE
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN turbo run build --filter="${PACKAGE}..."
RUN pnpm --filter="${PACKAGE}" deploy --prod --legacy /prod/app

# One-shot image for database migrations and development seeding.
FROM builder AS migrator
# The Prisma schema engine (migrations only) links against OpenSSL 3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo/packages/database
# Resolve the schema engine for the now-detected OpenSSL 3 platform at build time.
RUN pnpm exec prisma version
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM ${BASE_IMAGE} AS runner
ARG PORT=4000
ENV NODE_ENV=production \
    PORT=${PORT}
WORKDIR /app
COPY --from=builder --chown=node:node /prod/app ./
USER node
EXPOSE ${PORT}
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||process.env.PORT)+(process.env.HEALTH_PATH||'/health/live')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
