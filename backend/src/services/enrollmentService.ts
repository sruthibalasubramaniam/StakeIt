import type { EnrollmentStatus, Prisma, Stake } from '@prisma/client';
import { prisma, withTransaction, type PrismaTransactionClient } from '../lib/prisma';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { addDays, addHours } from '../utils/date';
import { env } from '../config/env';
import { WalletService } from './walletService';
import { NotificationService } from './notificationService';
import { LearningService } from './learningService';
import { computePacing } from '../lib/pacing';
import { toCourseSummary } from './courseService';

type Tx = PrismaTransactionClient;

const courseSummaryInclude = {
  instructor: {
    select: {
      id: true,
      fullName: true,
      headline: true,
      bio: true,
      avatarUrl: true,
      expertise: true,
      badges: { where: { isActive: true }, orderBy: { awardedAt: 'desc' } },
      _count: { select: { coursesTaught: true } },
    },
  },
  _count: { select: { enrollments: true, modules: true } },
  reviews: { where: { isPublished: true }, select: { rating: true, difficultyRating: true, wouldRecommend: true } },
  commitmentOptions: { where: { isActive: true }, orderBy: { orderIndex: 'asc' } },
} satisfies Prisma.CourseInclude;

/** Creates a new course attempt. Assumes the caller already validated eligibility. */
async function createAttempt(
  tx: Tx,
  params: {
    enrollmentId: string;
    userId: string;
    courseId: string;
    attemptNumber: number;
    durationDays: number;
    gracePeriodHours: number;
    acceleratedDurationDays?: number | null;
  },
) {
  const startedAt = new Date();
  const normalDeadline = addDays(startedAt, params.durationDays);
  const acceleratedDeadline =
    params.acceleratedDurationDays && params.acceleratedDurationDays > 0
      ? addDays(startedAt, params.acceleratedDurationDays)
      : null;

  return tx.courseAttempt.create({
    data: {
      enrollmentId: params.enrollmentId,
      userId: params.userId,
      courseId: params.courseId,
      attemptNumber: params.attemptNumber,
      status: 'ACTIVE',
      startedAt,
      normalDeadline,
      acceleratedDeadline,
      graceDeadline: addHours(normalDeadline, params.gracePeriodHours),
    },
  });
}

/** Locks a stake and records the matching ledger entry in one movement. */
async function lockStake(
  tx: Tx,
  params: {
    userId: string;
    courseId: string;
    attemptId: string;
    type: 'BASE' | 'COMMITMENT';
    amount: number;
    courseTitle: string;
    commitmentOptionId?: string | null;
  },
): Promise<Stake> {
  await WalletService.lockStake(tx, {
    userId: params.userId,
    amount: params.amount,
    description:
      params.type === 'BASE'
        ? `Base stake locked - ${params.courseTitle}`
        : `Accelerated commitment stake locked - ${params.courseTitle}`,
    referenceType: 'COURSE_ATTEMPT',
    referenceId: params.attemptId,
    metadata: { stakeType: params.type },
  });

  return tx.stake.create({
    data: {
      userId: params.userId,
      courseId: params.courseId,
      attemptId: params.attemptId,
      type: params.type,
      amount: params.amount,
      status: 'LOCKED',
      commitmentOptionId: params.commitmentOptionId ?? null,
    },
  });
}

export const EnrollmentService = {
  /**
   * Enrols a learner and locks their stake.
   *
   * Everything below runs inside one transaction: balance check, point
   * deduction, stake row, wallet ledger row, attempt row and enrolment
   * counters. If any step fails the whole enrolment rolls back, so a learner
   * can never end up enrolled without a stake — or staked without a course.
   */
  async enroll(
    courseId: string,
    userId: string,
    input: { commitmentOptionId?: string | null; accelerated?: boolean } = {},
  ) {
    const result = await withTransaction(async (tx) => {
      const course = await tx.course.findUnique({
        where: { id: courseId },
        include: { commitmentOptions: { where: { isActive: true } } },
      });
      if (!course) throw notFound('Course');
      if (course.status !== 'PUBLISHED') {
        throw conflict('This course is not open for enrolment.', 'CONFLICT', { status: course.status });
      }

      const existing = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
        include: { attempts: { orderBy: { attemptNumber: 'desc' } } },
      });

      const activeAttempt = existing?.attempts.find((attempt) =>
        ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(attempt.status),
      );
      if (activeAttempt) {
        throw conflict('You already have an active attempt on this course.', 'ALREADY_ENROLLED', {
          enrollmentId: existing!.id,
          attemptId: activeAttempt.id,
        });
      }
      if (existing?.status === 'COMPLETED') {
        throw conflict('You have already completed this course.', 'CONFLICT', { enrollmentId: existing.id });
      }

      // --- resolve the optional accelerated commitment ----------------------
      let commitmentOption = null as (typeof course.commitmentOptions)[number] | null;
      if (input.accelerated || input.commitmentOptionId) {
        if (input.commitmentOptionId) {
          commitmentOption =
            course.commitmentOptions.find((option) => option.id === input.commitmentOptionId) ?? null;
          if (!commitmentOption) throw notFound('Accelerated commitment option');
        } else {
          commitmentOption = course.commitmentOptions.find((option) => option.isDefault) ?? course.commitmentOptions[0] ?? null;
        }
        if (!commitmentOption) {
          throw unprocessable(
            'This course does not offer an accelerated commitment option.',
            'VALIDATION_ERROR',
          );
        }
      }

      // --- retry vs first attempt -------------------------------------------
      const isRetry = Boolean(existing);
      const previousAttemptCount = existing?.attempts.length ?? 0;
      const attemptNumber = previousAttemptCount + 1;

      if (isRetry && previousAttemptCount >= course.maxAttempts) {
        throw unprocessable(
          `You have used all ${course.maxAttempts} attempts allowed for this course.`,
          'ATTEMPT_LIMIT_REACHED',
          { maxAttempts: course.maxAttempts, attemptsUsed: previousAttemptCount },
        );
      }

      const baseStakeAmount = isRetry ? 0 : course.baseStake;
      const commitmentStakeAmount = commitmentOption ? commitmentOption.commitmentStake : 0;
      const totalRequired = baseStakeAmount + commitmentStakeAmount;

      if (totalRequired > 0) {
        const wallet = await WalletService.getOrCreateWallet(tx, userId);
        if (wallet.availableBalance < totalRequired) {
          throw unprocessable(
            `You need ${totalRequired} points to enrol but only ${wallet.availableBalance} are available.`,
            'INSUFFICIENT_BALANCE',
            {
              required: totalRequired,
              available: wallet.availableBalance,
              shortfall: totalRequired - wallet.availableBalance,
            },
          );
        }
      }

      const enrollment = existing
        ? await tx.enrollment.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', attemptCount: attemptNumber },
          })
        : await tx.enrollment.create({
            data: { userId, courseId, status: 'ACTIVE', attemptCount: attemptNumber },
          });

      const attempt = await createAttempt(tx, {
        enrollmentId: enrollment.id,
        userId,
        courseId,
        attemptNumber,
        durationDays: course.durationDays,
        gracePeriodHours: course.gracePeriodHours,
        acceleratedDurationDays: commitmentOption?.durationDays ?? null,
      });

      const stakes: Stake[] = [];

      if (baseStakeAmount > 0) {
        stakes.push(
          await lockStake(tx, {
            userId,
            courseId,
            attemptId: attempt.id,
            type: 'BASE',
            amount: baseStakeAmount,
            courseTitle: course.title,
          }),
        );
      }

      if (commitmentOption && commitmentStakeAmount > 0) {
        stakes.push(
          await lockStake(tx, {
            userId,
            courseId,
            attemptId: attempt.id,
            type: 'COMMITMENT',
            amount: commitmentStakeAmount,
            courseTitle: course.title,
            commitmentOptionId: commitmentOption.id,
          }),
        );
      }

      await NotificationService.notify(tx, {
        userId,
        type: 'ENROLLMENT',
        title: isRetry ? `Retry attempt ${attemptNumber} started` : 'Enrolment confirmed',
        message: isRetry
          ? `Your retry for ${course.title} is active. The deadline is ${attempt.normalDeadline.toDateString()}.`
          : `You are enrolled in ${course.title}. ${totalRequired > 0 ? `${totalRequired} points are now staked.` : ''}`,
        link: `/learn/${enrollment.id}`,
        metadata: { referenceId: attempt.id },
      });

      if (commitmentOption) {
        await NotificationService.notify(tx, {
          userId,
          type: 'ACCELERATED_DEADLINE',
          title: 'Accelerated deadline locked in',
          message: `Finish ${course.title} by ${attempt.acceleratedDeadline?.toDateString()} to earn the ${commitmentOption.commitmentBonus}-point bonus.`,
          link: `/learn/${enrollment.id}`,
          metadata: { referenceId: attempt.id },
        });
      }

      const wallet = await WalletService.getOrCreateWallet(tx, userId);

      return {
        enrollment,
        attempt,
        stakes,
        course,
        wallet,
        commitmentOption,
        isRetry,
        attemptNumber,
      };
    });

    return {
      enrollment: {
        id: result.enrollment.id,
        courseId: result.enrollment.courseId,
        status: result.enrollment.status,
        attemptCount: result.enrollment.attemptCount,
        enrolledAt: result.enrollment.enrolledAt,
      },
      attempt: {
        id: result.attempt.id,
        attemptNumber: result.attempt.attemptNumber,
        status: result.attempt.status,
        startedAt: result.attempt.startedAt,
        normalDeadline: result.attempt.normalDeadline,
        acceleratedDeadline: result.attempt.acceleratedDeadline,
        graceDeadline: result.attempt.graceDeadline,
      },
      isRetry: result.isRetry,
      stakes: result.stakes.map((stake) => ({
        id: stake.id,
        type: stake.type,
        amount: stake.amount,
        status: stake.status,
        lockedAt: stake.lockedAt,
      })),
      commitment: result.commitmentOption
        ? {
            id: result.commitmentOption.id,
            label: result.commitmentOption.label,
            durationDays: result.commitmentOption.durationDays,
            commitmentStake: result.commitmentOption.commitmentStake,
            commitmentBonus: result.commitmentOption.commitmentBonus,
          }
        : null,
      wallet: {
        availableBalance: result.wallet.availableBalance,
        lockedBalance: result.wallet.lockedBalance,
        totalBalance: result.wallet.availableBalance + result.wallet.lockedBalance,
      },
      potentialReturn: {
        stake: result.stakes.reduce((sum, stake) => sum + stake.amount, 0),
        completionReward: result.course.completionReward,
        commitmentBonus: result.commitmentOption?.commitmentBonus ?? 0,
        performanceBonus: result.course.performanceBonus,
        total:
          result.stakes.reduce((sum, stake) => sum + stake.amount, 0) +
          result.course.completionReward +
          (result.commitmentOption?.commitmentBonus ?? 0) +
          result.course.performanceBonus,
      },
    };
  },

  /** Everything the learner needs for the "My Courses" / dashboard lists. */
  async listEnrollments(
    userId: string,
    query: { status?: string; page?: unknown; pageSize?: unknown } = {},
  ) {
    const statusFilter = query.status && query.status !== 'ALL' ? (query.status as EnrollmentStatus) : undefined;
    const where: Prisma.EnrollmentWhereInput = { userId, ...(statusFilter ? { status: statusFilter } : {}) };

    const enrollments = await prisma.enrollment.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        course: { include: courseSummaryInclude },
        attempts: {
          orderBy: { attemptNumber: 'desc' },
          include: { stakes: true, progress: { select: { contentId: true, status: true } } },
        },
        review: true,
      },
    });

    const activeAttemptIds = enrollments
      .flatMap((enrollment) => enrollment.attempts)
      .filter((attempt) => ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(attempt.status))
      .map((attempt) => attempt.id);

    const progressMap = await LearningService.summarizeAttemptProgress(activeAttemptIds);

    return enrollments.map((enrollment) => {
      const activeAttempt =
        enrollment.attempts.find((attempt) => ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(attempt.status)) ??
        enrollment.attempts[0];
      const progressPercent = activeAttempt ? progressMap.get(activeAttempt.id) ?? 0 : 0;

      const pacing = activeAttempt
        ? computePacing({
            startedAt: activeAttempt.startedAt,
            normalDeadline: activeAttempt.normalDeadline,
            acceleratedDeadline: activeAttempt.acceleratedDeadline,
            graceDeadline: activeAttempt.graceDeadline,
            actualProgressPercent: progressPercent,
            atRiskThresholdPercent: env.AT_RISK_THRESHOLD_PERCENT,
          })
        : null;

      const lockedStake = activeAttempt
        ? activeAttempt.stakes.filter((stake) => stake.status === 'LOCKED').reduce((sum, stake) => sum + stake.amount, 0)
        : 0;

      return {
        id: enrollment.id,
        courseId: enrollment.courseId,
        status: enrollment.status,
        attemptCount: enrollment.attemptCount,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        bestScore: enrollment.bestScore,
        course: toCourseSummary(enrollment.course as never),
        review: enrollment.review
          ? { rating: enrollment.review.rating, reviewText: enrollment.review.reviewText, createdAt: enrollment.review.createdAt }
          : null,
        activeAttempt: activeAttempt
          ? {
              id: activeAttempt.id,
              attemptNumber: activeAttempt.attemptNumber,
              status: activeAttempt.status,
              startedAt: activeAttempt.startedAt,
              normalDeadline: activeAttempt.normalDeadline,
              acceleratedDeadline: activeAttempt.acceleratedDeadline,
              graceDeadline: activeAttempt.graceDeadline,
              completedAt: activeAttempt.completedAt,
              finalScore: activeAttempt.finalScore,
              moduleScore: activeAttempt.moduleScore,
              finalTestScore: activeAttempt.finalTestScore,
              pointsAwarded: activeAttempt.pointsAwarded,
              pointsForfeited: activeAttempt.pointsForfeited,
              commitmentMet: activeAttempt.commitmentMet,
              progressPercent,
            }
          : null,
        pacing,
        stake: {
          locked: lockedStake,
          baseStake: enrollment.course.baseStake,
          completionReward: enrollment.course.completionReward,
          commitmentBonus: enrollment.course.commitmentBonus,
          performanceBonus: enrollment.course.performanceBonus,
          potentialReward:
            lockedStake + enrollment.course.completionReward + enrollment.course.commitmentBonus + enrollment.course.performanceBonus,
        },
        attempts: enrollment.attempts.map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          startedAt: attempt.startedAt,
          normalDeadline: attempt.normalDeadline,
          completedAt: attempt.completedAt,
          failedAt: attempt.failedAt,
          finalScore: attempt.finalScore,
          pointsAwarded: attempt.pointsAwarded,
          pointsForfeited: attempt.pointsForfeited,
        })),
      };
    });
  },

  /**
   * Resolves the attempt the learner should land on for
   * `/learn/:enrollmentId` — the active one, else the newest settled one.
   */
  async getLearningEntry(enrollmentId: string, userId: string) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        course: { include: courseSummaryInclude },
        attempts: { orderBy: { attemptNumber: 'desc' }, include: { stakes: true } },
      },
    });

    if (!enrollment) throw notFound('Enrolment');
    if (enrollment.userId !== userId) throw forbidden('This enrolment belongs to another learner.');

    const active =
      enrollment.attempts.find((attempt) => ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(attempt.status)) ?? null;
    const settled = enrollment.attempts[0] ?? null;
    const target = active ?? settled;

    if (!target) throw notFound('Course attempt');

    return {
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        attemptCount: enrollment.attemptCount,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        bestScore: enrollment.bestScore,
      },
      course: toCourseSummary(enrollment.course as never),
      attemptId: target.id,
      attemptNumber: target.attemptNumber,
      attemptStatus: target.status,
      isSettled: !active,
      canRetry:
        enrollment.status === 'FAILED' &&
        enrollment.attemptCount < enrollment.course.maxAttempts,
      attemptsRemaining: Math.max(0, enrollment.course.maxAttempts - enrollment.attemptCount),
      // The learner lands on the completion receipt after a successful course.
      redirectToCompletion: target.status === 'COMPLETED',
    };
  },

  /** Explicit retry entry point; delegates to `enroll` so the rules stay in one place. */
  async retry(enrollmentId: string, userId: string, input: { commitmentOptionId?: string | null; accelerated?: boolean } = {}) {
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw notFound('Enrolment');
    if (enrollment.userId !== userId) throw forbidden('This enrolment belongs to another learner.');

    const course = await prisma.course.findUnique({ where: { id: enrollment.courseId } });
    if (!course) throw notFound('Course');

    if (enrollment.attemptCount >= course.maxAttempts) {
      throw unprocessable(
        `You have used all ${course.maxAttempts} attempts allowed for this course.`,
        'ATTEMPT_LIMIT_REACHED',
        { maxAttempts: course.maxAttempts, attemptsUsed: enrollment.attemptCount },
      );
    }

    const stillActive = await prisma.courseAttempt.findFirst({
      where: { enrollmentId, status: { in: ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'] } },
      select: { id: true },
    });
    if (stillActive) {
      throw conflict('You still have an active attempt on this course.', 'ALREADY_ENROLLED', {
        attemptId: stillActive.id,
      });
    }

    return this.enroll(enrollment.courseId, userId, input);
  },

  /**
   * Voluntary withdrawal. Allowed only before any verified progress, and any
   * locked stake is returned in full.
   */
  async withdraw(enrollmentId: string, userId: string) {
    return withTransaction(async (tx) => {
      const enrollment = await tx.enrollment.findUnique({
        where: { id: enrollmentId },
        include: { attempts: { include: { stakes: true } }, course: true },
      });
      if (!enrollment) throw notFound('Enrolment');
      if (enrollment.userId !== userId) throw forbidden('This enrolment belongs to another learner.');

      const activeAttempt = enrollment.attempts.find((attempt) =>
        ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(attempt.status),
      );
      if (!activeAttempt) throw conflict('There is no active attempt to withdraw from.', 'ATTEMPT_NOT_ACTIVE');

      const completedContent = await tx.contentProgress.count({
        where: { attemptId: activeAttempt.id, status: 'COMPLETED' },
      });
      if (completedContent > 0) {
        throw conflict('You cannot withdraw after starting the course content.');
      }

      let returned = 0;
      for (const stake of activeAttempt.stakes.filter((entry) => entry.status === 'LOCKED')) {
        await WalletService.releaseStake(tx, {
          userId,
          amount: stake.amount,
          description: `Stake returned on withdrawal - ${enrollment.course.title}`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: activeAttempt.id,
        });
        await tx.stake.update({
          where: { id: stake.id },
          data: { status: 'RETURNED', settledAt: new Date(), returnedAmount: stake.amount, settlementReason: 'Learner withdrew' },
        });
        returned += stake.amount;
      }

      await tx.courseAttempt.update({
        where: { id: activeAttempt.id },
        data: { status: 'ABANDONED' },
      });
      await tx.enrollment.update({
        where: { id: enrollmentId },
        data: { status: 'WITHDRAWN' },
      });

      return { enrollmentId, returnedPoints: returned };
    });
  },

  async getAttemptForLearner(attemptId: string, userId: string) {
    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: { course: true, enrollment: true, stakes: true },
    });
    if (!attempt) throw notFound('Course attempt');
    if (attempt.userId !== userId) throw forbidden('This attempt belongs to another learner.');
    return attempt;
  },
};
