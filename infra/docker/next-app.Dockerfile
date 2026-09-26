# syntax=docker/dockerfile:1.7
# Builds a Next.js app (web or admin) using the standalone output.
#
#   docker build -f infra/docker/next-app.Dockerfile \
#     --build-arg PACKAGE=@stormvpn/web --build-arg APP_PATH=apps/web -t stormvpn/web .

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
ARG APP_PATH
# Rewrites are resolved at build time; nginx routes /api directly in deployments.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN turbo run build --filter="${PACKAGE}..."

FROM ${BASE_IMAGE} AS runner
ARG APP_PATH
ARG PORT=3000
ENV NODE_ENV=production \
    PORT=${PORT} \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_PATH=${APP_PATH}
WORKDIR /app
COPY --from=builder --chown=node:node /repo/${APP_PATH}/.next/standalone ./
COPY --from=builder --chown=node:node /repo/${APP_PATH}/.next/static ./${APP_PATH}/.next/static
COPY --from=builder --chown=node:node /repo/${APP_PATH}/public ./${APP_PATH}/public
USER node
EXPOSE ${PORT}
CMD ["sh", "-c", "exec node ${APP_PATH}/server.js"]
