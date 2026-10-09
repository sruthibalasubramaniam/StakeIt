import type { BadgeTier, Prisma, Role } from '@prisma/client';
import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { resolvePagination, paginated } from '../utils/http';
import { addDays } from '../utils/date';
import { WalletService } from './walletService';
import { RewardPoolService } from './rewardPoolService';
import { NotificationService } from './notificationService';
import { DeadlineService } from './deadlineService';
import { StakeService } from './stakeService';
import { ReputationService } from './reputationService';
import { toPublicUser, toWalletSummary } from '../utils/serializers';

export const AdminService = {
  /* ---------------------------------------------------------------------- */
  /* Users                                                                   */
  /* ---------------------------------------------------------------------- */

  async listUsers(query: {
    role?: string;
    q?: string;
    isActive?: string;
    page?: unknown;
    pageSize?: unknown;
    sort?: string;
  }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.UserWhereInput = {};

    if (query.role && query.role !== 'ALL') where.role = query.role as Role;
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;
    if (query.q?.trim()) {
      const term = query.q.trim();
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: query.sort === 'name' ? { fullName: 'asc' } : { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          wallet: true,
          _count: { select: { enrollments: true, coursesTaught: true, stakes: true } },
          badges: { where: { isActive: true }, select: { tier: true, awardedAt: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return paginated(
      users.map((user) => ({
        ...toPublicUser(user),
        wallet: toWalletSummary(user.wallet),
        counts: {
          enrollments: user._count.enrollments,
          courses: user._count.coursesTaught,
          stakes: user._count.stakes,
        },
        badge: user.badges[0]?.tier ?? null,
      })),
      total,
      pagination,
    );
  },

  async getUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        enrollments: {
          include: { course: { select: { id: true, title: true, code: true } }, attempts: true },
        },
        coursesTaught: { select: { id: true, title: true, code: true, status: true } },
        badges: { orderBy: { awardedAt: 'desc' } },
        walletTxns: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });
    if (!user) throw notFound('User');

    return {
      ...toPublicUser(user),
      wallet: toWalletSummary(user.wallet),
      enrollments: user.enrollments.map((enrollment) => ({
        id: enrollment.id,
        status: enrollment.status,
        attemptCount: enrollment.attemptCount,
        course: enrollment.course,
        attempts: enrollment.attempts.map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          finalScore: attempt.finalScore,
          normalDeadline: attempt.normalDeadline,
          pointsAwarded: attempt.pointsAwarded,
          pointsForfeited: attempt.pointsForfeited,
        })),
      })),
      courses: user.coursesTaught,
      badges: user.badges,
      transactions: user.walletTxns,
    };
  },

  async updateUser(
    userId: string,
    actorId: string,
    input: { role?: Role; isActive?: boolean; fullName?: string; headline?: string | null },
  ) {
    if (userId === actorId && input.role && input.role !== 'ADMIN') {
      throw conflict('You cannot remove your own administrator role.');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
        ...(input.headline !== undefined ? { headline: input.headline } : {}),
      },
      include: { wallet: true },
    });

    return { ...toPublicUser(updated), wallet: toWalletSummary(updated.wallet) };
  },

  /**
   * Hard-deletes a user only when they carry no financial history. Accounts
   * with transactions are deactivated instead so the ledger stays auditable.
   */
  async deleteUser(userId: string, actorId: string) {
    if (userId === actorId) throw conflict('You cannot delete your own account.');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { walletTxns: true, enrollments: true, coursesTaught: true } } },
    });
    if (!user) throw notFound('User');

    if (user._count.walletTxns > 0 || user._count.enrollments > 0 || user._count.coursesTaught > 0) {
      await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
      return {
        id: userId,
        deleted: false,
        deactivated: true,
        reason: 'Account has ledger, enrolment or course history and was deactivated instead of deleted.',
      };
    }

    await prisma.user.delete({ where: { id: userId } });
    return { id: userId, deleted: true, deactivated: false };
  },

  async grantPoints(params: { userId: string; amount: number; reason: string; actorId: string }) {
    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw notFound('User');
    if (params.amount === 0) throw badRequest('Adjustment amount cannot be zero.');

    const transaction = await WalletService.adjustBalance({
      userId: params.userId,
      amount: params.amount,
      description: params.reason,
      actorId: params.actorId,
    });

    await NotificationService.notifySafely({
      userId: params.userId,
      type: 'SYSTEM',
      title: params.amount > 0 ? `${params.amount} points credited` : `${Math.abs(params.amount)} points debited`,
      message: params.reason,
      link: '/wallet',
      metadata: { referenceId: transaction.id },
    });

    const wallet = await WalletService.getSnapshot(params.userId);
    return { transaction, wallet };
  },

  /* ---------------------------------------------------------------------- */
  /* Moderation                                                              */
  /* ---------------------------------------------------------------------- */

  async listReviews(query: { flaggedOnly?: string; courseId?: string; page?: unknown; pageSize?: unknown }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.CourseReviewWhereInput = {};
    if (query.flaggedOnly === 'true') where.isFlagged = true;
    if (query.courseId) where.courseId = query.courseId;

    const [reviews, total] = await Promise.all([
      prisma.courseReview.findMany({
        where,
        orderBy: [{ isFlagged: 'desc' }, { createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          course: { select: { id: true, title: true, code: true, instructorId: true } },
        },
      }),
      prisma.courseReview.count({ where }),
    ]);

    return paginated(reviews, total, pagination);
  },

  async moderateReview(
    reviewId: string,
    input: { isFlagged?: boolean; flagReason?: string | null; isPublished?: boolean },
  ) {
    const review = await prisma.courseReview.findUnique({ where: { id: reviewId } });
    if (!review) throw notFound('Review');

    return prisma.courseReview.update({
      where: { id: reviewId },
      data: {
        ...(input.isFlagged !== undefined ? { isFlagged: input.isFlagged } : {}),
        ...(input.flagReason !== undefined ? { flagReason: input.flagReason } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      },
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Exceptional cases                                                       */
  /* ---------------------------------------------------------------------- */

  /** Extends both the normal and grace deadlines of an attempt. */
  async extendDeadline(attemptId: string, days: number, reason: string, actorId: string) {
    if (days <= 0) throw badRequest('Extension must be a positive number of days.');

    const attempt = await prisma.courseAttempt.findUnique({ where: { id: attemptId }, include: { course: true } });
    if (!attempt) throw notFound('Course attempt');
    if (['COMPLETED', 'FAILED'].includes(attempt.status)) {
      throw conflict('Closed attempts cannot be extended.', 'ATTEMPT_NOT_ACTIVE');
    }

    const updated = await prisma.courseAttempt.update({
      where: { id: attemptId },
      data: {
        normalDeadline: addDays(attempt.normalDeadline, days),
        graceDeadline: addDays(attempt.graceDeadline, days),
        status: attempt.status === 'GRACE_PERIOD' ? 'ACTIVE' : attempt.status,
      },
    });

    await NotificationService.notifySafely({
      userId: attempt.userId,
      type: 'SYSTEM',
      title: 'Course deadline extended',
      message: `An administrator extended your deadline for ${attempt.course.title} by ${days} day(s). Reason: ${reason}`,
      link: '/my-courses',
      metadata: { referenceId: attemptId, actorId },
    });

    return updated;
  },

  /** Forces deadline processing for one attempt (useful for demos/support). */
  async settleAttemptNow(attemptId: string) {
    return StakeService.settleAttemptAtDeadline(attemptId);
  },

  /** Manually release every locked stake on an attempt (compassionate refund). */
  async releaseStakes(attemptId: string, reason: string, actorId: string) {
    return withTransaction(async (tx) => {
      const attempt = await tx.courseAttempt.findUnique({ where: { id: attemptId }, include: { course: true, stakes: true } });
      if (!attempt) throw notFound('Course attempt');

      let released = 0;
      for (const stake of attempt.stakes.filter((entry) => entry.status === 'LOCKED')) {
        await WalletService.releaseStake(tx, {
          userId: attempt.userId,
          amount: stake.amount,
          description: `Stake released by administrator - ${attempt.course.title} (${reason})`,
          referenceType: 'COURSE_ATTEMPT',
          referenceId: attempt.id,
        });
        await tx.stake.update({
          where: { id: stake.id },
          data: { status: 'RETURNED', settledAt: new Date(), returnedAmount: stake.amount, settlementReason: reason },
        });
        released += stake.amount;
      }

      await NotificationService.notify(tx, {
        userId: attempt.userId,
        type: 'REWARD_RECEIVED',
        title: `${released} points released`,
        message: `An administrator released your stake for ${attempt.course.title}. Reason: ${reason}`,
        link: '/wallet',
        metadata: { referenceId: attempt.id, actorId },
      });

      return { attemptId, releasedPoints: released };
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Reward pool & badges                                                    */
  /* ---------------------------------------------------------------------- */

  async adjustRewardPool(amount: number, reason: string, actorId: string) {
    if (amount === 0) throw badRequest('Adjustment amount cannot be zero.');
    const transaction = await RewardPoolService.adjust({ amount, description: reason, actorId });
    const pool = await RewardPoolService.getPool();
    return { transaction, pool };
  },

  async listCourses(query: { status?: string; q?: string; instructorId?: string; page?: unknown; pageSize?: unknown }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.CourseWhereInput = {};
    if (query.status && query.status !== 'ALL') where.status = query.status as never;
    if (query.instructorId) where.instructorId = query.instructorId;
    if (query.q?.trim()) {
      where.OR = [
        { title: { contains: query.q.trim(), mode: 'insensitive' } },
        { code: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          instructor: { select: { id: true, fullName: true, email: true } },
          _count: { select: { enrollments: true, modules: true, attempts: true } },
        },
      }),
      prisma.course.count({ where }),
    ]);

    return paginated(courses, total, pagination);
  },

  async listInstructors(query: { q?: string; page?: unknown; pageSize?: unknown }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.UserWhereInput = { role: 'INSTRUCTOR' };
    if (query.q?.trim()) {
      where.OR = [
        { fullName: { contains: query.q.trim(), mode: 'insensitive' } },
        { email: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }

    const [instructors, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          _count: { select: { coursesTaught: true } },
          badges: { where: { isActive: true }, orderBy: { awardedAt: 'desc' } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const enriched = await Promise.all(
      instructors.map(async (instructor) => {
        const metrics = await ReputationService.computeInstructorMetrics(instructor.id);
        return {
          ...toPublicUser(instructor),
          courseCount: instructor._count.coursesTaught,
          badge: instructor.badges[0]?.tier ?? 'NONE',
          metrics: {
            learnerOutcomes: metrics.learnerOutcomes,
            completionRate: metrics.completionRate,
            averageScore: metrics.averageScore,
            commitmentSuccessRate: metrics.commitmentSuccessRate,
            averageRating: metrics.averageRating,
            compositeScore: metrics.compositeScore,
          },
          eligibleTier: metrics.eligibleTier,
        };
      }),
    );

    return paginated(enriched, total, pagination);
  },

  async awardBadge(params: { instructorId: string; tier: BadgeTier; actorId: string; notes?: string }) {
    return ReputationService.overrideBadge({
      instructorId: params.instructorId,
      tier: params.tier,
      actorId: params.actorId,
      notes: params.notes,
    });
  },

  async recomputeReputation() {
    const results = await ReputationService.recomputeAllBadges();
    return { instructorsProcessed: results.length, changes: results.filter((entry) => entry.changed) };
  },
};
