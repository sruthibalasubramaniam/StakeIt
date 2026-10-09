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
    timeout: options.timeout ?? 15_000,
    maxWait: options.maxWait ?? 10_000,
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
