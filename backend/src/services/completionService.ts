import { createHash } from 'node:crypto';
import type { CourseAttempt, Enrollment, Prisma, Stake, WalletTransaction } from '@prisma/client';
import { prisma, withTransaction, type PrismaTransactionClient } from '../lib/prisma';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { LearningService } from './learningService';
import { WalletService } from './walletService';
import { NotificationService } from './notificationService';
import { RewardPoolService } from './rewardPoolService';
import { roundTo } from '../utils/date';

type Tx = PrismaTransactionClient;

/* -------------------------------------------------------------------------- */
/* Pure scoring arithmetic                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Final course score.
 *
 *   finalScore = moduleScore × moduleWeight% + finalTestScore × finalTestWeight%
 *
 * Weights are validated to total 100 at course level, and re-asserted here so
 * a corrupted row can never silently mis-score a learner.
 */
export function computeFinalScore(params: {
  moduleScore: number;
  finalTestScore: number;
  moduleWeight: number;
  finalTestWeight: number;
}): number {
  const { moduleScore, finalTestScore, moduleWeight, finalTestWeight } = params;

  if (moduleWeight + finalTestWeight !== 100) {
    throw badRequest(
      `Score weights must total 100% (received module=${moduleWeight}%, final=${finalTestWeight}%).`,
    );
  }

  const weighted = (moduleScore * moduleWeight + finalTestScore * finalTestWeight) / 100;
  return roundTo(weighted, 2);
}

/**
 * Retry recovery reward: original stake ÷ attempt number, floored.
 *
 *   Attempt 2 completes → 100 / 2 = 50
 *   Attempt 3 completes → 100 / 3 ≈ 33
 */
export function computeRetryRecoveryReward(originalStake: number, attemptNumber: number): number {
  if (attemptNumber < 1) throw badRequest('Attempt number must be at least 1.');
  if (attemptNumber === 1) return originalStake;
  return Math.floor(originalStake / attemptNumber);
}

export function isPerformanceBonusEarned(finalScore: number, threshold: number): boolean {
  return finalScore >= threshold;
}

/** Stable audit hash so a settlement receipt can be independently re-verified. */
export function settlementHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildAuditReference(attempt: { id: string; attemptNumber: number; createdAt: Date }): string {
  const suffix = createHash('sha1').update(`${attempt.id}:${attempt.attemptNumber}`).digest('hex').slice(0, 6).toUpperCase();
  const year = attempt.createdAt.getUTCFullYear();
  return `STK-${year}-${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* Module score                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Weighted module score using each module's best quiz/assessment results:
 *
 *   moduleScore = quizAverage × moduleQuizWeight% + assessmentAverage × moduleAssessmentWeight%
 *
 * The course module score is the mean across modules that have gradable
 * instruments. Videos and readings are completion gates, not marks.
 */
export async function computeModuleScore(client: Tx | typeof prisma, attemptId: string): Promise<number> {
  const attempt = await client.courseAttempt.findUnique({
    where: { id: attemptId },
    include: {
      course: {
        include: {
          modules: {
            orderBy: { orderIndex: 'asc' },
            include: {
              contents: {
                select: {
                  id: true,
                  type: true,
                  quiz: { select: { id: true } },
                  assessment: { select: { id: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!attempt) throw notFound('Course attempt');

  const contents = attempt.course.modules.flatMap((module) => module.contents);
  const quizIds = contents.map((content) => content.quiz?.id).filter((id): id is string => Boolean(id));
  const assessmentIds = contents.map((content) => content.assessment?.id).filter((id): id is string => Boolean(id));

  const [quizAttempts, submissions] = await Promise.all([
    quizIds.length
      ? client.quizAttempt.findMany({ where: { attemptId, quizId: { in: quizIds } } })
      : Promise.resolve([] as Array<{ quizId: string; percentage: number }>),
    assessmentIds.length
      ? client.assessmentSubmission.findMany({ where: { attemptId, assessmentId: { in: assessmentIds } } })
      : Promise.resolve([] as Array<{ assessmentId: string; percentage: number }>),
  ]);

  const bestQuiz = new Map<string, number>();
  for (const entry of quizAttempts) {
    bestQuiz.set(entry.quizId, Math.max(bestQuiz.get(entry.quizId) ?? 0, entry.percentage));
  }
  const bestAssessment = new Map<string, number>();
  for (const entry of submissions) {
    bestAssessment.set(entry.assessmentId, Math.max(bestAssessment.get(entry.assessmentId) ?? 0, entry.percentage));
  }

  const moduleScores: number[] = [];

  for (const module of attempt.course.modules) {
    const quizScores = module.contents
      .map((content) => (content.quiz ? bestQuiz.get(content.quiz.id) : undefined))
      .filter((value): value is number => value !== undefined);
    const assessmentScores = module.contents
      .map((content) => (content.assessment ? bestAssessment.get(content.assessment.id) : undefined))
      .filter((value): value is number => value !== undefined);

    if (quizScores.length === 0 && assessmentScores.length === 0) continue;

    const quizAverage = quizScores.length ? quizScores.reduce((sum, value) => sum + value, 0) / quizScores.length : 0;
    const assessmentAverage = assessmentScores.length
      ? assessmentScores.reduce((sum, value) => sum + value, 0) / assessmentScores.length
      : 0;

    // Weights are renormalised over the components the module actually has, so
    // a module without quizzes is not penalised by a phantom zero for a
    // component it never offered.
    const applicableWeight =
      (quizScores.length ? attempt.course.moduleQuizWeight : 0) +
      (assessmentScores.length ? attempt.course.moduleAssessmentWeight : 0);

    moduleScores.push(
      roundTo(
        (quizAverage * (quizScores.length ? attempt.course.moduleQuizWeight : 0) +
          assessmentAverage * (assessmentScores.length ? attempt.course.moduleAssessmentWeight : 0)) /
          applicableWeight,
        2,
      ),
    );
  }

  if (moduleScores.length === 0) return 0;
  return roundTo(moduleScores.reduce((sum, value) => sum + value, 0) / moduleScores.length, 2);
}

/* -------------------------------------------------------------------------- */
/* Settlement                                                                  */
/* -------------------------------------------------------------------------- */

export interface SettlementLine {
  label: string;
  amount: number;
  transactionType: WalletTransaction['type'];
}

export interface SettlementSummary {
  attemptId: string;
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  courseCode: string;
  attemptNumber: number;
  status: string;
  isRetry: boolean;
  auditReference: string;
  completedAt: Date;
  breakdown: {
    moduleScore: number;
    finalTestScore: number;
    finalScore: number;
    moduleWeight: number;
    finalTestWeight: number;
  };
  thresholds: {
    passingScore: number | null;
    minFinalTestScore: number | null;
    performanceThreshold: number;
    cohortThreshold: number;
    cohortThresholdSatisfied: boolean;
  };
  lines: SettlementLine[];
  stakeReturned: number;
  rewardsAwarded: number;
  totalCredited: number;
  pointsForfeited: number;
  commitmentMet: boolean | null;
  commitmentBonusAwarded: number;
  /** Whether the performance threshold was cleared AND a bonus was configured. */
  performanceBonusEarned: boolean;
  /** Points actually credited for the performance bonus. */
  performanceBonusPoints: number;
  recoveryReward: number;
  wallet: {
    availableBalance: number;
    lockedBalance: number;
    totalBalance: number;
  };
  ledgerTransactionIds: string[];
  hash: string;
  settledNow: boolean;
}

async function buildSummary(
  attempt: CourseAttempt & { course: { title: string; code: string; performanceThreshold: number; minFinalTestScore: number | null }; stakes: Stake[] },
  wallet: { availableBalance: number; lockedBalance: number },
  lines: SettlementLine[],
  ledgerIds: string[],
  extra: {
    commitmentMet: boolean | null;
    commitmentBonusAwarded: number;
    performanceBonusEarned: boolean;
    recoveryReward: number;
    pointsForfeited: number;
    settledNow: boolean;
  },
): Promise<SettlementSummary> {
  const moduleScore = attempt.moduleScore ?? 0;
  const finalTestScore = attempt.finalTestScore ?? 0;
  const finalScore = attempt.finalScore ?? 0;
  const auditReference = buildAuditReference({ id: attempt.id, attemptNumber: attempt.attemptNumber, createdAt: attempt.createdAt });

  const stakeReturned = lines
    .filter((line) => line.transactionType === 'STAKE_RETURNED')
    .reduce((sum, line) => sum + line.amount, 0);
  const rewardsAwarded = lines
    .filter((line) => line.transactionType !== 'STAKE_RETURNED')
    .reduce((sum, line) => sum + line.amount, 0);

  const hash = settlementHash({
    auditReference,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    moduleScore,
    finalTestScore,
    finalScore,
    lines,
    completedAt: attempt.completedAt?.toISOString() ?? null,
  });

  return {
    attemptId: attempt.id,
    enrollmentId: attempt.enrollmentId,
    courseId: attempt.courseId,
    courseTitle: attempt.course.title,
    courseCode: attempt.course.code,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    isRetry: attempt.attemptNumber > 1,
    auditReference,
    completedAt: attempt.completedAt ?? new Date(),
    breakdown: {
      moduleScore,
      finalTestScore,
      finalScore,
      moduleWeight: 0,
      finalTestWeight: 0,
    },
    thresholds: {
      passingScore: null,
      minFinalTestScore: attempt.course.minFinalTestScore,
      performanceThreshold: attempt.course.performanceThreshold,
      cohortThreshold: attempt.course.performanceThreshold,
      cohortThresholdSatisfied: isPerformanceBonusEarned(finalScore, attempt.course.performanceThreshold),
    },
    lines,
    stakeReturned,
    rewardsAwarded,
    totalCredited: stakeReturned + rewardsAwarded,
    pointsForfeited: extra.pointsForfeited,
    commitmentMet: extra.commitmentMet,
    commitmentBonusAwarded: extra.commitmentBonusAwarded,
    performanceBonusEarned: extra.performanceBonusEarned,
    performanceBonusPoints: lines
      .filter((line) => line.transactionType === 'PERFORMANCE_BONUS')
      .reduce((sum, line) => sum + line.amount, 0),
    recoveryReward: extra.recoveryReward,
    wallet: {
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      totalBalance: wallet.availableBalance + wallet.lockedBalance,
    },
    ledgerTransactionIds: ledgerIds,
    hash,
    settledNow: extra.settledNow,
  };
}

export const CompletionService = {
  /**
   * Settles a successfully completed course attempt.
   *
   * Success path (spec §17):
   *   - base stake returned
   *   - completion reward
   *   - commitment stake returned + commitment bonus (only when the accelerated
   *     deadline was actually met)
   *   - performance bonus when finalScore >= performanceThreshold
   *
   * Retry path (spec §20): the stake was already forfeited on the failed
   * attempt, so instead of a stake return the learner receives a recovery
   * reward of `originalStake / attemptNumber`.
   *
   * Everything happens inside ONE transaction: wallet credits, ledger rows,
   * stake settlement, attempt update and enrolment update all commit together
   * or not at all.
   */
  async settleSuccessfulCompletion(attemptId: string): Promise<SettlementSummary> {
    const existing = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: { course: true, stakes: true, enrollment: true },
    });
    if (!existing) throw notFound('Course attempt');

    if (existing.status === 'COMPLETED') {
      // Idempotent replay: rebuild the receipt without moving any points again.
      const lines = await this.reconstructLines(attemptId);
      const wallet = await WalletService.getSnapshot(existing.userId);
      const summary = await buildSummary(
        existing,
        wallet,
        lines.lines,
        lines.ledgerIds,
        {
          commitmentMet: existing.commitmentMet,
          commitmentBonusAwarded: lines.commitmentBonusAwarded,
          performanceBonusEarned: existing.performanceBonusAwarded,
          recoveryReward: lines.recoveryReward,
          pointsForfeited: existing.pointsForfeited,
          settledNow: false,
        },
      );
      summary.breakdown.moduleWeight = existing.course.moduleWeight;
      summary.breakdown.finalTestWeight = existing.course.finalTestWeight;
      return summary;
    }

    if (existing.status !== 'ACTIVE' && existing.status !== 'AT_RISK' && existing.status !== 'GRACE_PERIOD') {
      throw conflict('This attempt is closed and cannot be settled as a completion.', 'ATTEMPT_NOT_ACTIVE');
    }

    const settled = await withTransaction(async (tx) => {
      // Re-read inside the transaction (with a fresh sequence) so the
      // completion claim is based on verified, committed progress.
      const attempt = await tx.courseAttempt.findUnique({
        where: { id: attemptId },
        include: { course: true, stakes: true, enrollment: true },
      });
      if (!attempt) throw notFound('Course attempt');
      if (attempt.status === 'COMPLETED') {
        throw conflict('This attempt was already settled.', 'ALREADY_SETTLED');
      }

      const context = await LearningService.loadAttempt(attemptId, attempt.userId, tx);
      const sequence = LearningService.buildSequence(context);

      const modulesIncomplete = sequence.modules.filter((module) => module.isRequired && !module.isCompleted);
      if (modulesIncomplete.length > 0) {
        throw unprocessable(
          'The course cannot be completed while required modules are outstanding.',
          'INVALID_PROGRESS',
          {
            modules: modulesIncomplete.map((module) => ({
              id: module.id,
              title: module.title,
              progressPercent: module.progressPercent,
            })),
          },
        );
      }

      const finalAssessment = sequence.finalAssessment;
      if (!finalAssessment) {
        throw unprocessable('This course has no final assessment configured.', 'INVALID_COURSE_CONFIGURATION');
      }
      if (!finalAssessment.passed) {
        throw unprocessable('The final course assessment has not been passed yet.', 'INVALID_PROGRESS', {
          bestPercentage: finalAssessment.bestPercentage,
          passingScore: finalAssessment.passingScore,
        });
      }

      const moduleScore = await computeModuleScore(tx, attemptId);
      const finalTestScore = finalAssessment.bestPercentage ?? 0;
      const finalScore = computeFinalScore({
        moduleScore,
        finalTestScore,
        moduleWeight: attempt.course.moduleWeight,
        finalTestWeight: attempt.course.finalTestWeight,
      });

      if (attempt.course.minFinalTestScore !== null && finalTestScore < attempt.course.minFinalTestScore) {
        throw unprocessable(
          `The final test score of ${finalTestScore}% is below the required minimum of ${attempt.course.minFinalTestScore}%.`,
          'INVALID_PROGRESS',
          { finalTestScore, minFinalTestScore: attempt.course.minFinalTestScore },
        );
      }

      const completedAt = new Date();
      const commitmentMet = attempt.acceleratedDeadline
        ? completedAt.getTime() <= attempt.acceleratedDeadline.getTime()
        : null;

      const lines: SettlementLine[] = [];
      const ledgerIds: string[] = [];
      const isRetry = attempt.attemptNumber > 1;

      const baseStake = attempt.stakes.find((stake) => stake.type === 'BASE' && stake.status === 'LOCKED');
      const commitmentStake = attempt.stakes.find((stake) => stake.type === 'COMMITMENT' && stake.status === 'LOCKED');

      if (!isRetry && baseStake) {
        // 1. Base stake returned.
        const txn = await WalletService.releaseStake(tx, {
          userId: attempt.userId,
          amount: baseStake.amount,
          description: `Base stake returned - ${attempt.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
        });
        ledgerIds.push(txn.id);
        lines.push({ label: 'Stake Returned', amount: baseStake.amount, transactionType: 'STAKE_RETURNED' });

        await tx.stake.update({
          where: { id: baseStake.id },
          data: {
            status: 'RETURNED',
            settledAt: completedAt,
            returnedAmount: baseStake.amount,
            settlementReason: 'Course completed successfully',
          },
        });
      } else if (isRetry) {
        // Recovery reward replaces the stake return on a retry.
        const recovery = computeRetryRecoveryReward(attempt.course.baseStake, attempt.attemptNumber);
        if (recovery > 0) {
          const txn = await WalletService.credit(tx, {
            userId: attempt.userId,
            amount: recovery,
            type: 'RETRY_REWARD',
            description: `Retry recovery reward (attempt ${attempt.attemptNumber}) - ${attempt.course.title}`,
            referenceType: 'COURSE_ATTEMPT',
            referenceId: attempt.id,
            metadata: { attemptNumber: attempt.attemptNumber, originalStake: attempt.course.baseStake },
          });
          ledgerIds.push(txn.id);
          lines.push({ label: 'Retry Recovery Reward', amount: recovery, transactionType: 'RETRY_REWARD' });
        }
      }

      // 2. Course completion reward (platform-funded).
      if (attempt.course.completionReward > 0) {
        const txn = await WalletService.credit(tx, {
          userId: attempt.userId,
          amount: attempt.course.completionReward,
          type: 'COURSE_REWARD',
          description: `Course completion reward - ${attempt.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
        });
        ledgerIds.push(txn.id);
        lines.push({ label: 'Course Reward', amount: attempt.course.completionReward, transactionType: 'COURSE_REWARD' });
      }

      // 3. Accelerated commitment: stake return + bonus, only if actually met.
      let commitmentBonusAwarded = 0;
      if (commitmentStake && commitmentMet) {
        const stakeTxn = await WalletService.releaseStake(tx, {
          userId: attempt.userId,
          amount: commitmentStake.amount,
          description: `Accelerated commitment stake returned - ${attempt.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
        });
        ledgerIds.push(stakeTxn.id);
        lines.push({
          label: 'Commitment Stake Returned',
          amount: commitmentStake.amount,
          transactionType: 'STAKE_RETURNED',
        });

        const bonus = commitmentStake.commitmentOptionId
          ? (
              await tx.courseCommitmentOption.findUnique({ where: { id: commitmentStake.commitmentOptionId } })
            )?.commitmentBonus ?? attempt.course.commitmentBonus
          : attempt.course.commitmentBonus;

        if (bonus > 0) {
          const bonusTxn = await WalletService.credit(tx, {
            userId: attempt.userId,
            amount: bonus,
            type: 'COMMITMENT_BONUS',
            description: `Accelerated deadline bonus - ${attempt.course.title}`,
            referenceType: 'COURSE_ATTEMPT',
            referenceId: attempt.id,
          });
          ledgerIds.push(bonusTxn.id);
          lines.push({ label: 'Early Finish Bonus', amount: bonus, transactionType: 'COMMITMENT_BONUS' });
          commitmentBonusAwarded = bonus;
        }

        await tx.stake.update({
          where: { id: commitmentStake.id },
          data: {
            status: 'RETURNED',
            settledAt: completedAt,
            returnedAmount: commitmentStake.amount + bonus,
            settlementReason: 'Accelerated deadline met',
          },
        });
      } else if (commitmentStake && commitmentMet === false) {
        // Missing the PERSONAL deadline never fails the course: the stake is
        // returned, only the bonus is forgone.
        const stakeTxn = await WalletService.releaseStake(tx, {
          userId: attempt.userId,
          amount: commitmentStake.amount,
          description: `Commitment stake returned (accelerated deadline missed) - ${attempt.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
        });
        ledgerIds.push(stakeTxn.id);
        lines.push({
          label: 'Commitment Stake Returned',
          amount: commitmentStake.amount,
          transactionType: 'STAKE_RETURNED',
        });

        await tx.stake.update({
          where: { id: commitmentStake.id },
          data: {
            status: 'RETURNED',
            settledAt: completedAt,
            returnedAmount: commitmentStake.amount,
            settlementReason: 'Completed after the accelerated deadline (bonus forgone)',
          },
        });
      }

      // 4. Performance bonus, driven by the FINAL COURSE SCORE.
      const performanceBonusEarned =
        attempt.course.performanceBonus > 0 &&
        isPerformanceBonusEarned(finalScore, attempt.course.performanceThreshold);

      if (performanceBonusEarned) {
        const txn = await WalletService.credit(tx, {
          userId: attempt.userId,
          amount: attempt.course.performanceBonus,
          type: 'PERFORMANCE_BONUS',
          description: `Performance bonus (final score ${finalScore}% >= ${attempt.course.performanceThreshold}%) - ${attempt.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
          metadata: { finalScore, threshold: attempt.course.performanceThreshold },
        });
        ledgerIds.push(txn.id);
        lines.push({
          label: 'Performance Bonus',
          amount: attempt.course.performanceBonus,
          transactionType: 'PERFORMANCE_BONUS',
        });
      }

      const pointsAwarded = lines.reduce((sum, line) => sum + line.amount, 0);

      const updatedAttempt = await tx.courseAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'COMPLETED',
          completedAt,
          moduleScore,
          finalTestScore,
          finalScore,
          commitmentMet,
          // Persisted column name; the local variable tracks the same fact.
          performanceBonusAwarded: performanceBonusEarned,
          pointsAwarded,
          pointsForfeited: 0,
        },
        include: { course: true, stakes: true, enrollment: true },
      });

      // Any stake still locked (e.g. edge-case data) is released, never
      // silently swallowed.
      const stillLocked = await tx.stake.findMany({ where: { attemptId, status: 'LOCKED' } });
      for (const stake of stillLocked) {
        await WalletService.releaseStake(tx, {
          userId: attempt.userId,
          amount: stake.amount,
          description: `Stake released on completion - ${attempt.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
        });
        await tx.stake.update({
          where: { id: stake.id },
          data: { status: 'RETURNED', settledAt: completedAt, returnedAmount: stake.amount, settlementReason: 'Course completed' },
        });
      }

      const enrollment = await tx.enrollment.update({
        where: { id: attempt.enrollmentId },
        data: {
          status: 'COMPLETED',
          completedAt,
          bestScore: Math.max(attempt.enrollment.bestScore ?? 0, finalScore),
        },
      });

      // A learner may only hold one successful settlement per course; any other
      // attempt in flight is closed as ABANDONED.
      await tx.courseAttempt.updateMany({
        where: { enrollmentId: attempt.enrollmentId, id: { not: attemptId }, status: { in: ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'] } },
        data: { status: 'ABANDONED' },
      });

      await NotificationService.notify(tx, {
        userId: attempt.userId,
        type: 'COURSE_COMPLETED',
        title: 'Course completed',
        message: `You completed ${attempt.course.title} with a final score of ${finalScore}%.`,
        link: `/learn/${attempt.enrollmentId}/completion`,
        metadata: { referenceId: attempt.id },
      });

      if (pointsAwarded > 0) {
        await NotificationService.notify(tx, {
          userId: attempt.userId,
          type: 'REWARD_RECEIVED',
          title: `${pointsAwarded} points credited`,
          message: `Your settlement for ${attempt.course.title} added ${pointsAwarded} points to your wallet.`,
          link: '/wallet',
          metadata: { referenceId: attempt.id },
        });
      }

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: attempt.userId } });
      const summary = await buildSummary(
        updatedAttempt,
        wallet,
        lines,
        ledgerIds,
        {
          commitmentMet,
          commitmentBonusAwarded,
          performanceBonusEarned: performanceBonusEarned,
          recoveryReward: lines.find((line) => line.transactionType === 'RETRY_REWARD')?.amount ?? 0,
          pointsForfeited: 0,
          settledNow: true,
        },
      );
      summary.breakdown.moduleWeight = attempt.course.moduleWeight;
      summary.breakdown.finalTestWeight = attempt.course.finalTestWeight;
      summary.thresholds.passingScore = finalAssessment.passingScore;
      void enrollment;

      return summary;
    });

    return settled;
  },

  /** Rebuilds settlement lines from the ledger for an already-settled attempt. */
  async reconstructLines(attemptId: string) {
    const transactions: WalletTransaction[] = await prisma.walletTransaction.findMany({
      where: { referenceType: 'COURSE_ATTEMPT', referenceId: attemptId, amount: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });

    const lines: SettlementLine[] = transactions
      .filter((txn) => txn.type !== 'STAKE_LOCKED' && txn.type !== 'STAKE_FORFEITED')
      .map((txn) => ({
        label:
          txn.type === 'STAKE_RETURNED'
            ? 'Stake Returned'
            : txn.type === 'COURSE_REWARD'
              ? 'Course Reward'
              : txn.type === 'COMMITMENT_BONUS'
                ? 'Early Finish Bonus'
                : txn.type === 'PERFORMANCE_BONUS'
                  ? 'Performance Bonus'
                  : txn.type === 'RETRY_REWARD'
                    ? 'Retry Recovery Reward'
                    : txn.description,
        amount: txn.amount,
        transactionType: txn.type,
      }));

    return {
      lines,
      ledgerIds: transactions.map((txn) => txn.id),
      commitmentBonusAwarded: transactions.find((txn) => txn.type === 'COMMITMENT_BONUS')?.amount ?? 0,
      recoveryReward: transactions.find((txn) => txn.type === 'RETRY_REWARD')?.amount ?? 0,
    };
  },

  /** Settlement receipt for the completion summary screen. */
  async getSettlement(attemptId: string, userId: string): Promise<SettlementSummary> {
    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: { course: true, stakes: true, enrollment: true },
    });
    if (!attempt) throw notFound('Course attempt');
    if (attempt.userId !== userId) throw conflict('This attempt belongs to another learner.', 'FORBIDDEN');

    if (attempt.status !== 'COMPLETED') {
      throw unprocessable('This course attempt has not been completed yet.', 'INVALID_PROGRESS', {
        status: attempt.status,
      });
    }

    const { lines, ledgerIds, commitmentBonusAwarded, recoveryReward } = await this.reconstructLines(attemptId);
    const wallet = await WalletService.getSnapshot(userId);

    const summary = await buildSummary(attempt, wallet, lines, ledgerIds, {
      commitmentMet: attempt.commitmentMet,
      commitmentBonusAwarded,
      performanceBonusEarned: attempt.performanceBonusAwarded,
      recoveryReward,
      pointsForfeited: attempt.pointsForfeited,
      settledNow: false,
    });

    summary.breakdown.moduleWeight = attempt.course.moduleWeight;
    summary.breakdown.finalTestWeight = attempt.course.finalTestWeight;

    const finalAssessment = await prisma.assessment.findFirst({
      where: { courseId: attempt.courseId, type: 'FINAL' },
      select: { passingScore: true, _count: { select: { questions: true } } },
    });
    summary.thresholds.passingScore = finalAssessment?.passingScore ?? null;

    return summary;
  },

  /** Preview used by the dashboard ("what happens if I finish today?"). */
  async previewSettlement(attemptId: string, userId: string) {
    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: { course: true, stakes: true },
    });
    if (!attempt) throw notFound('Course attempt');
    if (attempt.userId !== userId) throw conflict('This attempt belongs to another learner.', 'FORBIDDEN');

    const context = await LearningService.loadAttempt(attemptId, userId);
    const sequence = LearningService.buildSequence(context);
    const moduleScore = await computeModuleScore(prisma, attemptId);
    const finalTestScore = sequence.finalAssessment?.bestPercentage ?? 0;
    const projectedFinalScore = computeFinalScore({
      moduleScore,
      finalTestScore,
      moduleWeight: attempt.course.moduleWeight,
      finalTestWeight: attempt.course.finalTestWeight,
    });

    const commitmentStake = attempt.stakes.filter((stake) => stake.status === 'LOCKED');

    return {
      attemptId,
      moduleScore,
      finalTestScore,
      projectedFinalScore,
      projectedPerformanceBonus:
        attempt.course.performanceBonus > 0 &&
        isPerformanceBonusEarned(projectedFinalScore, attempt.course.performanceThreshold)
          ? attempt.course.performanceBonus
          : 0,
      lockedStake: commitmentStake.reduce((sum, stake) => sum + stake.amount, 0),
      potentialReward:
        commitmentStake.reduce((sum, stake) => sum + stake.amount, 0) +
        attempt.course.completionReward +
        attempt.course.commitmentBonus +
        attempt.course.performanceBonus,
      modulesRemaining: sequence.modules.filter((module) => module.isRequired && !module.isCompleted).length,
      finalAssessmentUnlocked: sequence.finalAssessment?.isUnlocked ?? false,
    };
  },

  /** Forfeiture bookkeeping shared with the deadline engine. */
  async recordForfeiture(params: {
    tx: Tx;
    attempt: CourseAttempt & { course: { title: string } };
    stakes: Stake[];
    reason: string;
  }) {
    const { tx, attempt, stakes, reason } = params;
    let totalForfeited = 0;

    for (const stake of stakes) {
      await WalletService.forfeitStake(tx, {
        userId: attempt.userId,
        amount: stake.amount,
        description: `Stake forfeited - ${attempt.course.title} (${reason})`,
        referenceType: 'COURSE_ATTEMPT',
        referenceId: attempt.id,
      });

      await tx.stake.update({
        where: { id: stake.id },
        data: { status: 'FORFEITED', settledAt: new Date(), returnedAmount: 0, settlementReason: reason },
      });

      await RewardPoolService.credit(tx, {
        amount: stake.amount,
        type: 'FORFEIT_IN',
        description: `Forfeited stake from attempt ${attempt.id}`,
        referenceType: 'COURSE_ATTEMPT',
        referenceId: attempt.id,
        metadata: { userId: attempt.userId, stakeType: stake.type },
      });

      totalForfeited += stake.amount;
    }

    return totalForfeited;
  },
};

