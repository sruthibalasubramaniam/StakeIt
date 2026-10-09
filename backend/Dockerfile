# syntax=docker/dockerfile:1
# =============================================================================
# Stake It API — production image
#
# BUILD CONTEXT IS THE REPOSITORY ROOT (npm workspaces):
#   docker build -f backend/Dockerfile .
#   docker compose build api
#
# Stages: deps (install) -> build (tsc) -> runtime (non-root, migrations on boot)
# =============================================================================

FROM node:20-alpine AS base
WORKDIR /app
# openssl is required by Prisma's query engine on Alpine; curl powers the healthcheck.
RUN apk add --no-cache openssl curl

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM base AS deps
# Both workspace manifests are required: `npm ci` validates the lockfile against
# every workspace declared in the root package.json.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
# Installs the backend workspace (plus its hoisted, shared node_modules).
RUN npm ci --workspace backend --include-workspace-root

# ---------------------------------------------------------------------------
# Build (TypeScript -> dist)
# ---------------------------------------------------------------------------
FROM deps AS build
COPY backend/tsconfig.json backend/tsconfig.build.json ./backend/
COPY backend/prisma ./backend/prisma
COPY backend/src ./backend/src
# generate must run against the real schema so the client matches the database.
RUN cd backend && npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

# DevDependencies are installed deliberately: `prisma` (the CLI) lives there and
# the entrypoint needs it for `prisma migrate deploy`. Note that npm omits dev
# dependencies whenever NODE_ENV=production is set, so NODE_ENV is exported
# *after* the install below — otherwise this line would silently do nothing and
# the container would fail at start-up.
RUN npm ci --workspace backend --include-workspace-root --include=dev && npm cache clean --force

COPY backend/prisma ./backend/prisma
RUN cd backend && npx prisma generate

COPY --from=build /app/backend/dist ./backend/dist

# The TypeScript sources are shipped alongside the compiled output because
# `prisma/seed.ts` imports the service layer directly (`../src/services/...`) and
# is executed with tsx. Without this the documented seed step
# (`npm run db:seed`) fails inside the container with MODULE_NOT_FOUND.
COPY backend/src ./backend/src

COPY backend/docker-entrypoint.sh ./backend/docker-entrypoint.sh

# Production mode for everything the process actually does at runtime.
ENV NODE_ENV=production

RUN chmod +x ./backend/docker-entrypoint.sh \
 && addgroup -g 1001 -S nodejs \
 && adduser -S -u 1001 -G nodejs stakeit \
 && chown -R stakeit:nodejs /app

USER stakeit
EXPOSE 4000

# Verifies process liveness only — no database round-trip, so a transient
# database hiccup cannot flap the container.
HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./backend/docker-entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
