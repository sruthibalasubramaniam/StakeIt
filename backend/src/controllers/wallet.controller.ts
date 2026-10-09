import type { Request, Response } from 'express';
import { WalletService } from '../services/walletService';
import { StakeService } from '../services/stakeService';
import { RewardPoolService } from '../services/rewardPoolService';
import { RecommendationService } from '../services/recommendationService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const WalletController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const [wallet, stakeSummary] = await Promise.all([
      WalletService.getSnapshot(userId),
      StakeService.summary(userId),
    ]);
    res.status(200).json({ data: { ...wallet, stakes: stakeSummary } });
  }),

  transactions: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await WalletService.listTransactions(userId, req.query as never);
    res.status(200).json({ data: result });
  }),

  insights: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await RecommendationService.getInsights(userId);
    res.status(200).json({ data: result });
  }),
};

export const StakeController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await StakeService.listStakes(userId, req.query as never);
    res.status(200).json({ data: result });
  }),

  summary: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await StakeService.summary(userId);
    res.status(200).json({ data: result });
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await StakeService.getStake(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),
};

export const RewardController = {
  /** Learner-facing rewards summary: what has been earned and what is at play. */
  list: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const [wallet, stakeSummary, insights] = await Promise.all([
      WalletService.getSnapshot(userId),
      StakeService.summary(userId),
      RecommendationService.getInsights(userId),
    ]);

    const transactions = await WalletService.listTransactions(userId, {
      pageSize: 50,
      type: 'COURSE_REWARD,COMMITMENT_BONUS,PERFORMANCE_BONUS,RETRY_REWARD,SIGNUP_GRANT',
    });

    const totals = (transactions.items as Array<{ type: string; amount: number }>).reduce<Record<string, number>>(
      (accumulator, entry) => {
        accumulator[entry.type] = (accumulator[entry.type] ?? 0) + entry.amount;
        return accumulator;
      },
      {},
    );

    res.status(200).json({
      data: {
        wallet,
        stakes: stakeSummary,
        totals: {
          courseRewards: totals.COURSE_REWARD ?? 0,
          commitmentBonuses: totals.COMMITMENT_BONUS ?? 0,
          performanceBonuses: totals.PERFORMANCE_BONUS ?? 0,
          retryRewards: totals.RETRY_REWARD ?? 0,
          welcomeGrant: totals.SIGNUP_GRANT ?? 0,
          lifetimeEarned: wallet.lifetimeEarned,
        },
        history: transactions.items,
        pagination: transactions.pagination,
        insights,
      },
    });
  }),

  pool: asyncHandler(async (req: Request, res: Response) => {
    const { role } = authContext(req);
    const pool = await RewardPoolService.getPool();
    if (role === 'ADMIN') {
      const transactions = await RewardPoolService.listTransactions(req.query as never);
      res.status(200).json({ data: { pool, transactions } });
      return;
    }
    // Non-admins see the pool size only.
    res.status(200).json({ data: { pool } });
  }),
};
