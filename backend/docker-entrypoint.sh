#!/bin/sh
# =============================================================================
# Stake It API entrypoint
#
# Applies pending Prisma migrations before the server starts, then hands off to
# the CMD. Controlled by environment variables so the same image can be used for
# a managed database (Supabase) or a self-hosted PostgreSQL.
#
#   RUN_MIGRATIONS_ON_START=true|false   (default: true)
#   MIGRATE_MAX_ATTEMPTS=<n>             (default: 5)
#   MIGRATE_RETRY_DELAY_SECONDS=<n>      (default: 6)
#
# On a managed database whose schema was created with `prisma db push` there are
# no migration files, so `migrate deploy` is a no-op — it is safe to leave on.
# =============================================================================
set -eu

RUN_MIGRATIONS_ON_START="${RUN_MIGRATIONS_ON_START:-true}"
MIGRATE_MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-5}"
MIGRATE_RETRY_DELAY_SECONDS="${MIGRATE_RETRY_DELAY_SECONDS:-6}"

if [ "$RUN_MIGRATIONS_ON_START" != "true" ]; then
  echo "[entrypoint] RUN_MIGRATIONS_ON_START=$RUN_MIGRATIONS_ON_START — skipping migrations"
  exec "$@"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

# The database may still be starting (self-hosted compose) or briefly
# unreachable (managed host) — retry instead of crashing the container.
attempt=1
while [ "$attempt" -le "$MIGRATE_MAX_ATTEMPTS" ]; do
  echo "[entrypoint] (${attempt}/${MIGRATE_MAX_ATTEMPTS}) prisma migrate deploy"
  if (cd backend && npx --no-install prisma migrate deploy); then
    echo "[entrypoint] migrations applied"
    break
  fi

  if [ "$attempt" -eq "$MIGRATE_MAX_ATTEMPTS" ]; then
    echo "[entrypoint] FATAL: could not apply migrations after ${MIGRATE_MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi

  attempt=$((attempt + 1))
  sleep "$MIGRATE_RETRY_DELAY_SECONDS"
done

echo "[entrypoint] starting: $*"
exec "$@"
