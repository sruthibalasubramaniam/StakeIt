import type { Prisma, StakeStatus } from '@prisma/client';
import { prisma, withTransaction, type PrismaTransactionClient } from '../lib/prisma';
import { conflict, notFound } from '../lib/errors';
import { LearningService } from './learningService';
import { CompletionService } from './completionService';
import { NotificationService } from './notificationService';
import { resolvePagination, paginated } from '../utils/http';

type Tx = PrismaTransactionClient;

export const StakeService = {
  async listStakes(
    userId: string,
    query: { status?: string; courseId?: string; page?: unknown; pageSize?: unknown } = {},
  ) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.StakeWhereInput = { userId };

    if (query.status && query.status !== 'ALL') {
      where.status = { in: query.status.split(',').map((value) => value.trim()) as StakeStatus[] };
    }
    if (query.courseId) where.courseId = query.courseId;

    const [stakes, total] = await Promise.all([
      prisma.stake.findMany({
        where,
        orderBy: [{ status: 'asc' }, { lockedAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          course: { select: { id: true, title: true, code: true, slug: true, baseStake: true, completionReward: true, commitmentBonus: true, performanceBonus: true } },
          attempt: {
            select: {
              id: true,
              attemptNumber: true,
              status: true,
              normalDeadline: true,
              acceleratedDeadline: true,
              graceDeadline: true,
              finalScore: true,
              completedAt: true,
              failedAt: true,
            },
          },
          commitmentOption: { select: { id: true, label: true, durationDays: true, commitmentBonus: true } },
        },
      }),
      prisma.stake.count({ where }),
    ]);

    const items = stakes.map((stake) => ({
      id: stake.id,
      type: stake.type,
      amount: stake.amount,
      status: stake.status,
      lockedAt: stake.lockedAt,
      settledAt: stake.settledAt,
      settlementReason: stake.settlementReason,
      returnedAmount: stake.returnedAmount,
      course: stake.course,
      commitment:
        stake.type === 'COMMITMENT'
          ? {
              label: stake.commitmentOption?.label ?? 'Accelerated commitment',
              durationDays: stake.commitmentOption?.durationDays ?? null,
              commitmentBonus: stake.commitmentOption?.commitmentBonus ?? null,
            }
          : null,
      attempt: stake.attempt,
    }));

    const result = paginated(items, total, pagination);

    // Aggregate totals for the /stakes header (matching the design's summary row).
    const [lockedAgg, returnedAgg, forfeitedAgg] = await Promise.all([
      prisma.stake.aggregate({ where: { userId, status: 'LOCKED' }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.stake.aggregate({ where: { userId, status: 'RETURNED' }, _sum: { returnedAmount: true }, _count: { _all: true } }),
      prisma.stake.aggregate({ where: { userId, status: 'FORFEITED' }, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    return {
      ...result,
      totals: {
        lockedPoints: lockedAgg._sum.amount ?? 0,
        lockedCount: lockedAgg._count._all,
        returnedPoints: returnedAgg._sum.returnedAmount ?? 0,
        returnedCount: returnedAgg._count._all,
        forfeitedPoints: forfeitedAgg._sum.amount ?? 0,
        forfeitedCount: forfeitedAgg._count._all,
      },
    };
  },

  async getStake(stakeId: string, userId: string, role: string) {
    const stake = await prisma.stake.findUnique({
      where: { id: stakeId },
      include: {
        course: true,
        attempt: { include: { enrollment: true } },
        commitmentOption: true,
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!stake) throw notFound('Stake');
    if (role !== 'ADMIN' && stake.userId !== userId) {
      throw conflict('This stake belongs to another learner.', 'FORBIDDEN');
    }
    return stake;
  },

  async summary(userId: string) {
    const [locked, forfeited, returned, commitmentStakes] = await Promise.all([
      prisma.stake.aggregate({ where: { userId, status: 'LOCKED' }, _sum: { amount: true } }),
      prisma.stake.aggregate({ where: { userId, status: 'FORFEITED' }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.stake.aggregate({ where: { userId, status: 'RETURNED' }, _sum: { returnedAmount: true }, _count: { _all: true } }),
      prisma.stake.count({ where: { userId, type: 'COMMITMENT', status: 'LOCKED' } }),
    ]);

    return {
      activeStakePoints: locked._sum.amount ?? 0,
      forfeitedPoints: forfeited._sum.amount ?? 0,
      forfeitedCount: forfeited._count._all,
      returnedPoints: returned._sum.returnedAmount ?? 0,
      returnedCount: returned._count._all,
      activeCommitments: commitmentStakes,
    };
  },

  /**
   * Failure settlement (spec §19).
   *
   * Called by the deadline engine once the grace period has elapsed without
   * verified completion:
   *   - every locked stake is forfeited
   *   - the points land in the platform reward pool (never another learner)
   *   - the attempt and enrolment are closed as FAILED
   *   - the learner is told they may retry, if attempts remain
   *
   * Runs in one transaction so the wallet, ledger, pool and attempt status can
   * never disagree.
   */
  async settleFailedAttempt(attemptId: string, reason = 'Course deadline missed'): Promise<{
    attemptId: string;
    forfeitedPoints: number;
    retryAvailable: boolean;
    attemptsRemaining: number;
  } | null> {
    return withTransaction(async (tx) => {
      const attempt = await tx.courseAttempt.findUnique({
        where: { id: attemptId },
        include: { course: true, stakes: true, enrollment: true },
      });
      if (!attempt) throw notFound('Course attempt');

      // Idempotent: already-settled attempts are skipped rather than double-forfeited.
      if (attempt.status === 'FAILED' || attempt.status === 'COMPLETED' || attempt.status === 'ABANDONED') {
        return null;
      }

      const lockedStakes = attempt.stakes.filter((stake) => stake.status === 'LOCKED');
      const failedAt = new Date();
      const totalForfeited = await CompletionService.recordForfeiture({
        tx,
        attempt,
        stakes: lockedStakes,
        reason,
      });

      await tx.courseAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'FAILED',
          failedAt,
          pointsForfeited: totalForfeited,
          pointsAwarded: 0,
        },
      });

      await tx.courseAttempt.updateMany({
        where: {
          enrollmentId: attempt.enrollmentId,
          id: { not: attemptId },
          status: { in: ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'] },
        },
        data: { status: 'ABANDONED' },
      });

      const attemptsUsed = await tx.courseAttempt.count({ where: { enrollmentId: attempt.enrollmentId } });
      const attemptsRemaining = Math.max(0, attempt.course.maxAttempts - attemptsUsed);

      await tx.enrollment.update({
        where: { id: attempt.enrollmentId },
        data: { status: attemptsRemaining > 0 ? 'FAILED' : 'FAILED', attemptCount: attemptsUsed },
      });

      if (totalForfeited > 0) {
        await NotificationService.notify(tx, {
          userId: attempt.userId,
          type: 'STAKE_FORFEITED',
          title: `${totalForfeited} points forfeited`,
          message: `Your attempt on ${attempt.course.title} expired without verified completion. The stake has moved to the platform reward pool.`,
          link: '/stakes',
          metadata: { referenceId: attempt.id },
        });
      }

      if (attemptsRemaining > 0) {
        await NotificationService.notify(tx, {
          userId: attempt.userId,
          type: 'RETRY_AVAILABLE',
          title: 'Retry available',
          message: `You can retry ${attempt.course.title} — ${attemptsRemaining} attempt(s) remaining. A retry does not require a new stake.`,
          link: `/courses/${attempt.courseId}`,
          metadata: { referenceId: attempt.id },
        });
      }

      return {
        attemptId,
        forfeitedPoints: totalForfeited,
        retryAvailable: attemptsRemaining > 0,
        attemptsRemaining,
      };
    });
  },

  /**
   * Deadline check used by both the scheduled job and on-demand admin actions.
   * If the learner actually finished everything, we settle success instead of
   * forfeiting.
   */
  async settleAttemptAtDeadline(attemptId: string): Promise<{
    outcome: 'COMPLETED' | 'FAILED' | 'SKIPPED';
    forfeitedPoints: number;
    detail?: string;
  }> {
    const attempt = await prisma.courseAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw notFound('Course attempt');

    if (['COMPLETED', 'FAILED', 'ABANDONED'].includes(attempt.status)) {
      return { outcome: 'SKIPPED', forfeitedPoints: 0, detail: `Attempt already ${attempt.status}` };
    }

    const context = await LearningService.loadAttempt(attemptId, attempt.userId);
    const sequence = LearningService.buildSequence(context);
    const verifiedComplete =
      sequence.modules.filter((module) => module.isRequired).every((module) => module.isCompleted) &&
      Boolean(sequence.finalAssessment?.passed);

    if (verifiedComplete) {
      await CompletionService.settleSuccessfulCompletion(attemptId);
      return { outcome: 'COMPLETED', forfeitedPoints: 0, detail: 'Verified completion after deadline — settled as success.' };
    }

    const result = await this.settleFailedAttempt(attemptId, 'Course deadline missed');
    return {
      outcome: 'FAILED',
      forfeitedPoints: result?.forfeitedPoints ?? 0,
      detail: result ? 'Stake forfeited to the reward pool.' : 'Attempt was already settled.',
    };
  },
};
