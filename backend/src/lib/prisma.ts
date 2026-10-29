import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env';

/**
 * A single PrismaClient per process. In development the client is cached on
 * `globalThis` so `tsx watch` hot-reloads do not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * `PRISMA_LOG_QUERIES=true` emits every SQL statement Prisma runs. It is an
 * opt-in diagnostic used to audit N+1 access patterns in critical paths; it is
 * off by default (and never enabled in production) so it cannot flood logs.
 */
const queryLogging =
  process.env.PRISMA_LOG_QUERIES === 'true' && !isProduction
    ? ([{ emit: 'event', level: 'query' }, 'warn', 'error'] as const)
    : (['warn', 'error'] as const);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...queryLogging],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Interactive-transaction helper with a sane default timeout. All financial
 * (point) mutations must run through this so a failure rolls the whole
 * operation back.
 */
export function withTransaction<T>(
  handler: (tx: PrismaTransactionClient) => Promise<T>,
  options: { timeout?: number; maxWait?: number; isolationLevel?: 'Serializable' | 'ReadCommitted' } = {},
): Promise<T> {
  return prisma.$transaction(handler, {
    timeout: options.timeout ?? env.TX_TIMEOUT_MS,
    maxWait: options.maxWait ?? env.TX_MAX_WAIT_MS,
    isolationLevel: options.isolationLevel,
  });
}

/**
 * Serialises competing wallet mutations by taking a row-level lock. Postgres
 * `SELECT ... FOR UPDATE` inside a transaction is the canonical way to prevent
 * lost updates on a balance.
 */
export async function lockWalletRow(tx: PrismaTransactionClient, walletId: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${walletId}::uuid FOR UPDATE`;
}

/** Same guard for the singleton reward-pool row. */
export async function lockRewardPoolRow(tx: PrismaTransactionClient, poolId: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM reward_pool WHERE id = ${poolId} FOR UPDATE`;
}

/* -------------------------------------------------------------------------- */
/* Startup readiness                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `true` once this process has held at least one working database connection.
 *
 * It starts `false` and gates the API (see `createApp`): until the database has
 * been reached, data routes answer 503 SERVICE_UNAVAILABLE instead of failing
 * deep inside Prisma with an opaque 500.
 */
let databaseReady = false;

export function isDatabaseReady(): boolean {
  return databaseReady;
}

export function markDatabaseReady(ready = true): void {
  databaseReady = ready;
}

/**
 * Connects with bounded exponential backoff, swallowing the error so the caller
 * can keep the HTTP listener alive.
 *
 * Why this exists: the API used to call `prisma.$connect()` once and
 * `process.exit(1)` on failure. A managed database (the Supabase pooler) or a
 * `depends_on` PostgreSQL can be unreachable for the first minute or two after
 * `docker compose up`. During that window the container exited, Docker restarted
 * it with a backoff that grows to 60s, and nginx proxying to a dead upstream
 * answered **502 Bad Gateway** for every request — the login POST included.
 * Retrying in-process keeps a live listener behind the proxy and recovers on the
 * next attempt rather than on the next container restart.
 *
 * @returns `true` when a connection was established, `false` when a finite
 * attempt budget was exhausted. It never rejects.
 */
export async function connectWithRetry(options: {
  /** Number of attempts; `0` (the default) keeps retrying until it succeeds. */
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onAttempt?: (attempt: number, error: unknown) => void;
} = {}): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 0;
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 5_000;

  for (let attempt = 1; maxAttempts === 0 || attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$connect();
      markDatabaseReady(true);
      return true;
    } catch (error) {
      markDatabaseReady(false);
      options.onAttempt?.(attempt, error);
      if (maxAttempts !== 0 && attempt >= maxAttempts) return false;
      // The delay is capped deliberately: the database can come back at any
      // moment, and a tight reconnect cadence is what makes recovery feel
      // immediate instead of waiting out a 60s container backoff.
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return false;
}
