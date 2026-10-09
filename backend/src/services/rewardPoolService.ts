import type { Prisma, RewardPool, RewardPoolTransaction, RewardPoolTransactionType } from '@prisma/client';
import { prisma, lockRewardPoolRow, withTransaction, type PrismaTransactionClient } from '../lib/prisma';
import { resolvePagination, paginated } from '../utils/http';

type Tx = PrismaTransactionClient;

/**
 * The reward pool is a singleton ledger that receives forfeited stakes.
 *
 * Business rule: forfeited points are NEVER transferred straight to another
 * learner. They land here and are only paid out through an explicit,
 * auditable platform reward (or an admin adjustment).
 */
export const POOL_ID = 'platform';

export interface PoolEntryInput {
  amount: number;
  type: RewardPoolTransactionType;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

async function lockedPool(tx: Tx): Promise<RewardPool> {
  await tx.rewardPool.upsert({
    where: { id: POOL_ID },
    update: {},
    create: { id: POOL_ID, balance: 0 },
  });
  await lockRewardPoolRow(tx, POOL_ID);
  return tx.rewardPool.findUniqueOrThrow({ where: { id: POOL_ID } });
}

function writePoolLedger(
  tx: Tx,
  pool: RewardPool,
  input: PoolEntryInput,
  balanceAfter: number,
): Promise<RewardPoolTransaction> {
  return tx.rewardPoolTransaction.create({
    data: {
      poolId: POOL_ID,
      type: input.type,
      amount: input.amount,
      balanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      description: input.description,
      actorId: input.actorId ?? null,
    },
  });
}

export const RewardPoolService = {
  async ensurePool(tx: Tx): Promise<RewardPool> {
    return tx.rewardPool.upsert({
      where: { id: POOL_ID },
      update: {},
      create: { id: POOL_ID, balance: 0 },
    });
  },

  async getPool() {
    const pool = await prisma.rewardPool.upsert({
      where: { id: POOL_ID },
      update: {},
      create: { id: POOL_ID, balance: 0 },
    });

    return {
      balance: pool.balance,
      totalIn: pool.totalIn,
      totalOut: pool.totalOut,
      updatedAt: pool.updatedAt,
    };
  },

  /** Credit forfeited points into the pool. Amount must be positive. */
  async credit(tx: Tx, input: PoolEntryInput & { amount: number }): Promise<RewardPoolTransaction> {
    if (input.amount <= 0) throw new Error('RewardPool.credit() requires a positive amount');
    const pool = await lockedPool(tx);

    const updated = await tx.rewardPool.update({
      where: { id: POOL_ID },
      data: { balance: { increment: input.amount }, totalIn: { increment: input.amount } },
    });

    return writePoolLedger(tx, updated, input, updated.balance);
  },

  /** Pay points out of the pool (platform-funded learner rewards). */
  async debit(tx: Tx, input: PoolEntryInput & { amount: number }): Promise<RewardPoolTransaction> {
    if (input.amount <= 0) throw new Error('RewardPool.debit() requires a positive amount');
    const pool = await lockedPool(tx);

    if (pool.balance < input.amount) {
      throw new Error(
        `Invariant violation: reward pool holds ${pool.balance} points but ${input.amount} were requested.`,
      );
    }

    const updated = await tx.rewardPool.update({
      where: { id: POOL_ID },
      data: { balance: { decrement: input.amount }, totalOut: { increment: input.amount } },
    });

    return writePoolLedger(tx, updated, { ...input, amount: -input.amount }, updated.balance);
  },

  async listTransactions(query: { page?: unknown; pageSize?: unknown; type?: unknown }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.RewardPoolTransactionWhereInput = {};

    if (typeof query.type === 'string' && query.type && query.type !== 'ALL') {
      where.type = { in: query.type.split(',').map((value) => value.trim()) as RewardPoolTransactionType[] };
    }

    const [items, total] = await Promise.all([
      prisma.rewardPoolTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        include: { actor: { select: { id: true, fullName: true, email: true } } },
      }),
      prisma.rewardPoolTransaction.count({ where }),
    ]);

    return paginated(items, total, pagination);
  },

  /** Admin-only manual movement of pool points. */
  async adjust(params: { amount: number; description: string; actorId: string }) {
    return withTransaction(async (tx) => {
      const input: PoolEntryInput = {
        amount: Math.abs(params.amount),
        type: 'ADMIN_ADJUSTMENT',
        description: params.description,
        referenceType: 'ADMIN',
        actorId: params.actorId,
        metadata: { signedAmount: params.amount },
      };
      return params.amount >= 0 ? this.credit(tx, input) : this.debit(tx, input);
    });
  },
};
