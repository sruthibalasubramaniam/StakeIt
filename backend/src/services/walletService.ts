import type { Prisma, Wallet, WalletTransaction, WalletTransactionType } from '@prisma/client';
import { prisma, lockWalletRow, withTransaction, type PrismaTransactionClient } from '../lib/prisma';
import { insufficientBalance, notFound } from '../lib/errors';
import { resolvePagination, paginated, type Pagination } from '../utils/http';
import { roundTo } from '../utils/date';

type Tx = PrismaTransactionClient;

/**
 * Transaction types that increase `lifetimeEarned`. A returned stake is a
 * *return of the learner's own points*, not an earning, so it is excluded.
 */
const EARNING_TYPES: WalletTransactionType[] = [
  'SIGNUP_GRANT',
  'COURSE_REWARD',
  'COMMITMENT_BONUS',
  'PERFORMANCE_BONUS',
  'RETRY_REWARD',
];

export interface LedgerEntryInput {
  userId: string;
  amount: number;
  type: WalletTransactionType;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface WalletSnapshot {
  walletId: string;
  availableBalance: number;
  lockedBalance: number;
  totalBalance: number;
  lifetimeEarned: number;
  lifetimeStaked: number;
  lifetimeForfeited: number;
  version: number;
}

function toSnapshot(wallet: Wallet): WalletSnapshot {
  return {
    walletId: wallet.id,
    availableBalance: wallet.availableBalance,
    lockedBalance: wallet.lockedBalance,
    totalBalance: wallet.availableBalance + wallet.lockedBalance,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeStaked: wallet.lifetimeStaked,
    lifetimeForfeited: wallet.lifetimeForfeited,
    version: wallet.version,
  };
}

/**
 * Row-locked wallet read. MUST be called inside a transaction — the
 * `SELECT ... FOR UPDATE` is what serialises concurrent point mutations.
 */
async function lockedWallet(tx: Tx, userId: string): Promise<Wallet> {
  const existing = await tx.wallet.findUnique({ where: { userId } });
  if (!existing) throw notFound('Wallet');
  await lockWalletRow(tx, existing.id);
  const locked = await tx.wallet.findUnique({ where: { id: existing.id } });
  if (!locked) throw notFound('Wallet');
  return locked;
}

function writeLedger(
  tx: Tx,
  wallet: Wallet,
  input: LedgerEntryInput,
  balanceAfter: number,
): Promise<WalletTransaction> {
  return tx.walletTransaction.create({
    data: {
      userId: input.userId,
      walletId: wallet.id,
      type: input.type,
      amount: input.amount,
      balanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      description: input.description,
      metadata: input.metadata,
    },
  });
}

export const WalletService = {
  async getOrCreateWallet(tx: Tx, userId: string): Promise<Wallet> {
    const existing = await tx.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return tx.wallet.create({ data: { userId } });
  },

  /** Read-only snapshot for the authenticated learner. */
  async getSnapshot(userId: string): Promise<WalletSnapshot> {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (wallet) return toSnapshot(wallet);
    const created = await prisma.wallet.create({ data: { userId } });
    return toSnapshot(created);
  },

  async listTransactions(
    userId: string,
    query: { page?: unknown; pageSize?: unknown; type?: unknown; referenceType?: unknown },
  ) {
    const pagination: Pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.WalletTransactionWhereInput = { userId };

    if (typeof query.type === 'string' && query.type !== 'ALL') {
      where.type = { in: query.type.split(',').map((value) => value.trim()) as WalletTransactionType[] };
    }
    if (typeof query.referenceType === 'string' && query.referenceType) {
      where.referenceType = query.referenceType;
    }

    const [items, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    return paginated(items, total, pagination);
  },

  /**
   * Adds points to the available balance (rewards, bonus, admin credits).
   * Returns the created ledger entry.
   */
  async credit(tx: Tx, input: LedgerEntryInput & { amount: number }): Promise<WalletTransaction> {
    if (input.amount <= 0) throw new Error('credit() requires a positive amount');
    const wallet = await lockedWallet(tx, input.userId);
    const lifetimeEarned = EARNING_TYPES.includes(input.type)
      ? wallet.lifetimeEarned + input.amount
      : wallet.lifetimeEarned;

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { increment: input.amount },
        lifetimeEarned,
        version: { increment: 1 },
      },
    });

    return writeLedger(tx, updated, input, updated.availableBalance);
  },

  /**
   * Removes points from the available balance. Throws
   * `INSUFFICIENT_BALANCE` (422) rather than allowing an overdraft.
   */
  async debit(tx: Tx, input: LedgerEntryInput & { amount: number }): Promise<WalletTransaction> {
    if (input.amount <= 0) throw new Error('debit() requires a positive amount');
    const wallet = await lockedWallet(tx, input.userId);

    if (wallet.availableBalance < input.amount) {
      throw insufficientBalance('Insufficient available points for this operation.', {
        required: input.amount,
        available: wallet.availableBalance,
        shortfall: input.amount - wallet.availableBalance,
      });
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { decrement: input.amount }, version: { increment: 1 } },
    });

    return writeLedger(tx, updated, { ...input, amount: -input.amount }, updated.availableBalance);
  },

  /**
   * Moves points from available -> locked. This is the atomic heart of
   * "staking": a single transaction deducts the spendable balance, records it
   * in the ledger and increments the locked balance.
   */
  async lockStake(
    tx: Tx,
    input: Omit<LedgerEntryInput, 'type'> & { amount: number; type?: WalletTransactionType },
  ): Promise<WalletTransaction> {
    if (input.amount <= 0) throw new Error('lockStake() requires a positive amount');
    const wallet = await lockedWallet(tx, input.userId);

    if (wallet.availableBalance < input.amount) {
      throw insufficientBalance('Insufficient available points to cover this stake.', {
        required: input.amount,
        available: wallet.availableBalance,
        shortfall: input.amount - wallet.availableBalance,
      });
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { decrement: input.amount },
        lockedBalance: { increment: input.amount },
        lifetimeStaked: { increment: input.amount },
        version: { increment: 1 },
      },
    });

    return writeLedger(
      tx,
      updated,
      { ...input, type: input.type ?? 'STAKE_LOCKED', amount: -input.amount },
      updated.availableBalance,
    );
  },

  /** Moves points back from locked -> available (successful settlement). */
  async releaseStake(
    tx: Tx,
    input: Omit<LedgerEntryInput, 'type'> & { amount: number; type?: WalletTransactionType },
  ): Promise<WalletTransaction> {
    if (input.amount <= 0) throw new Error('releaseStake() requires a positive amount');
    const wallet = await lockedWallet(tx, input.userId);

    if (wallet.lockedBalance < input.amount) {
      throw new Error(
        `Invariant violation: cannot release ${input.amount} points, only ${wallet.lockedBalance} are locked.`,
      );
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        lockedBalance: { decrement: input.amount },
        availableBalance: { increment: input.amount },
        version: { increment: 1 },
      },
    });

    return writeLedger(
      tx,
      updated,
      { ...input, type: input.type ?? 'STAKE_RETURNED', amount: input.amount },
      updated.availableBalance,
    );
  },

  /**
   * Removes points from the locked balance and records the forfeiture.
   * The points leave the learner entirely (they are credited to the reward
   * pool by `StakeService` inside the same transaction).
   */
  async forfeitStake(
    tx: Tx,
    input: Omit<LedgerEntryInput, 'type'> & { amount: number; type?: WalletTransactionType },
  ): Promise<WalletTransaction> {
    if (input.amount <= 0) throw new Error('forfeitStake() requires a positive amount');
    const wallet = await lockedWallet(tx, input.userId);

    if (wallet.lockedBalance < input.amount) {
      throw new Error(
        `Invariant violation: cannot forfeit ${input.amount} points, only ${wallet.lockedBalance} are locked.`,
      );
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        lockedBalance: { decrement: input.amount },
        lifetimeForfeited: { increment: input.amount },
        version: { increment: 1 },
      },
    });

    return writeLedger(
      tx,
      updated,
      { ...input, type: input.type ?? 'STAKE_FORFEITED', amount: -input.amount },
      updated.availableBalance,
    );
  },

  /** Standalone (self-transactional) variants used by admin tooling. */
  async adjustBalance(params: {
    userId: string;
    amount: number;
    description: string;
    actorId?: string | null;
  }): Promise<WalletTransaction> {
    return withTransaction(async (tx) => {
      const input: LedgerEntryInput = {
        userId: params.userId,
        amount: Math.abs(params.amount),
        type: 'ADMIN_ADJUSTMENT',
        description: params.description,
        referenceType: 'ADMIN',
        referenceId: params.actorId ?? null,
        metadata: { signedAmount: params.amount },
      };
      return params.amount >= 0 ? this.credit(tx, input) : this.debit(tx, input);
    });
  },

  /** Aggregate wallet statistics used by the admin dashboard. */
  async platformTotals(): Promise<{
    totalAvailable: number;
    totalLocked: number;
    totalAccounts: number;
    averageBalance: number;
  }> {
    const aggregate = await prisma.wallet.aggregate({
      _sum: { availableBalance: true, lockedBalance: true },
      _count: { _all: true },
      _avg: { availableBalance: true },
    });

    return {
      totalAvailable: aggregate._sum.availableBalance ?? 0,
      totalLocked: aggregate._sum.lockedBalance ?? 0,
      totalAccounts: aggregate._count._all,
      averageBalance: roundTo(aggregate._avg.availableBalance ?? 0, 1),
    };
  },
};

export type WalletServiceType = typeof WalletService;
