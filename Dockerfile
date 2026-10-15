# syntax=docker/dockerfile:1
# Base image pinned to a minor version. For fully reproducible builds pin the digest too,
# e.g. node:24.11-alpine3.22@sha256:<digest> (see README).

# ---- deps: install exact lockfile dependencies (musl prebuilds for @node-rs/argon2) ----
FROM node:24.11-alpine3.22 AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build: produce the standalone server ----
FROM node:24.11-alpine3.22 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: minimal, non-root ----
FROM node:24.11-alpine3.22 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# SQL migrations, applied at startup by src/instrumentation.ts under an advisory lock.
COPY --from=build --chown=app:app /app/drizzle ./drizzle
# Read-only root filesystem support: the only runtime write location Next uses is .next/cache,
# which points into /tmp (a tmpfs in docker-compose.yml). Nothing else is written at runtime.
RUN ln -s /tmp/next-cache /app/.next/cache
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
# exec keeps node as PID 1 so SIGTERM reaches Next's graceful shutdown.
CMD ["sh", "-c", "mkdir -p /tmp/next-cache && exec node server.js"]
