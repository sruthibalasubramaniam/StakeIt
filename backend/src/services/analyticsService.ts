import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { env } from '../config/env';
import { computePacing } from '../lib/pacing';
import { LearningService } from './learningService';
import { ReputationService } from './reputationService';
import { WalletService } from './walletService';
import { RewardPoolService } from './rewardPoolService';
import { paginated, resolvePagination } from '../utils/http';
import { roundTo } from '../utils/date';

export const AnalyticsService = {
  /* ---------------------------------------------------------------------- */
  /* Learner dashboard                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Everything the learner dashboard renders: points, active stakes, courses
   * with live progress and pacing, deadlines, recent rewards, transactions and
   * achievements.
   */
  async learnerDashboard(userId: string) {
    const [wallet, enrollments, notifications, stakeSummary] = await Promise.all([
      WalletService.getSnapshot(userId),
      prisma.enrollment.findMany({
        where: { userId },
        include: {
          course: {
            select: {
              id: true,
              code: true,
              slug: true,
              title: true,
              category: true,
              difficulty: true,
              durationDays: true,
              baseStake: true,
              completionReward: true,
              commitmentBonus: true,
              performanceBonus: true,
              coverImageUrl: true,
              instructor: { select: { id: true, fullName: true } },
            },
          },
          attempts: { include: { stakes: true }, orderBy: { attemptNumber: 'desc' } },
          review: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.stake.aggregate({ where: { userId, status: 'LOCKED' }, _sum: { amount: true } }),
    ]);

    const activeAttempts = enrollments
      .flatMap((enrollment) => enrollment.attempts)
      .filter((attempt) => ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(attempt.status));

    const progressMap = await LearningService.summarizeAttemptProgress(activeAttempts.map((attempt) => attempt.id));

    const activeCourses = enrollments
      .filter((enrollment) => enrollment.status === 'ACTIVE')
      .map((enrollment) => {
        const attempt =
          enrollment.attempts.find((entry) => ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'].includes(entry.status)) ??
          enrollment.attempts[0];
        if (!attempt) return null;

        const progressPercent = progressMap.get(attempt.id) ?? 0;
        const pacing = computePacing({
          startedAt: attempt.startedAt,
          normalDeadline: attempt.normalDeadline,
          acceleratedDeadline: attempt.acceleratedDeadline,
          graceDeadline: attempt.graceDeadline,
          actualProgressPercent: progressPercent,
          atRiskThresholdPercent: env.AT_RISK_THRESHOLD_PERCENT,
        });

        const lockedStake = attempt.stakes
          .filter((stake) => stake.status === 'LOCKED')
          .reduce((sum, stake) => sum + stake.amount, 0);

        return {
          enrollmentId: enrollment.id,
          attemptId: attempt.id,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          course: enrollment.course,
          progressPercent,
          pacing,
          lockedStake,
          // Concrete timestamps so the client can render real dates rather than
          // reconstructing them from the pacing summary.
          normalDeadline: attempt.normalDeadline,
          acceleratedDeadline: attempt.acceleratedDeadline,
          graceDeadline: attempt.graceDeadline,
          commitmentStake: attempt.stakes
            .filter((stake) => stake.type === 'COMMITMENT' && stake.status === 'LOCKED')
            .reduce((sum, stake) => sum + stake.amount, 0),
          potentialReward:
            lockedStake +
            enrollment.course.completionReward +
            enrollment.course.commitmentBonus +
            enrollment.course.performanceBonus,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const completedCourses = enrollments
      .filter((enrollment) => enrollment.status === 'COMPLETED')
      .map((enrollment) => {
        const attempt = enrollment.attempts.find((entry) => entry.status === 'COMPLETED') ?? enrollment.attempts[0];
        return {
          enrollmentId: enrollment.id,
          attemptId: attempt?.id ?? null,
          completedAt: enrollment.completedAt,
          finalScore: attempt?.finalScore ?? enrollment.bestScore,
          pointsAwarded: attempt?.pointsAwarded ?? 0,
          course: enrollment.course,
          hasReview: Boolean(enrollment.review),
        };
      })
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));

    const [recentRewards, recentTransactions] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: {
          userId,
          amount: { gt: 0 },
          type: { in: ['COURSE_REWARD', 'COMMITMENT_BONUS', 'PERFORMANCE_BONUS', 'RETRY_REWARD'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const atRiskCourses = activeCourses.filter((course) => course.pacing.isAtRisk);

    const upcomingDeadlines = [...activeCourses]
      .sort((a, b) => a.pacing.daysRemaining - b.pacing.daysRemaining)
      .slice(0, 5)
      .map((course) => ({
        enrollmentId: course.enrollmentId,
        attemptId: course.attemptId,
        courseId: course.course.id,
        title: course.course.title,
        code: course.course.code,
        normalDeadline: course.pacing.daysRemaining,
        acceleratedDaysRemaining: course.pacing.acceleratedDaysRemaining,
        riskLevel: course.pacing.riskLevel,
        riskLabel: course.pacing.riskLabel,
        hoursUntilForfeiture: course.pacing.hoursUntilForfeiture,
        progressPercent: course.progressPercent,
        lockedStake: course.lockedStake,
      }));

    const bestScore = completedCourses.reduce((best, course) => Math.max(best, course.finalScore ?? 0), 0);

    return {
      wallet,
      summary: {
        activeCourses: activeCourses.length,
        completedCourses: completedCourses.length,
        atRiskCourses: atRiskCourses.length,
        totalStaked: stakeSummary._sum.amount ?? 0,
        totalStakedCount: activeCourses.length,
        bestScore: roundTo(bestScore, 2),
        averageCompletedScore: completedCourses.length
          ? roundTo(
              completedCourses.reduce((sum, course) => sum + (course.finalScore ?? 0), 0) / completedCourses.length,
              2,
            )
          : 0,
      },
      activeCourses,
      atRisk: atRiskCourses.map((course) => ({
        enrollmentId: course.enrollmentId,
        attemptId: course.attemptId,
        title: course.course.title,
        code: course.course.code,
        progressPercent: course.progressPercent,
        expectedProgressPercent: course.pacing.expectedProgressPercent,
        gap: course.pacing.gap,
        daysRemaining: course.pacing.daysRemaining,
        lockedStake: course.lockedStake,
      })),
      upcomingDeadlines,
      completedCourses: completedCourses.slice(0, 6),
      recentRewards,
      recentTransactions,
      achievements: {
        certificates: completedCourses.length,
        bestScore: roundTo(bestScore, 2),
        perfectScores: completedCourses.filter((course) => (course.finalScore ?? 0) >= 90).length,
        performanceBonusesEarned: recentRewards.filter((txn) => txn.type === 'PERFORMANCE_BONUS').length,
        commitmentBonusesEarned: recentRewards.filter((txn) => txn.type === 'COMMITMENT_BONUS').length,
      },
      notifications,
    };
  },

  /* ---------------------------------------------------------------------- */
  /* Instructor                                                              */
  /* ---------------------------------------------------------------------- */

  async instructorDashboard(instructorId: string) {
    const courses = await prisma.course.findMany({
      where: { instructorId },
      select: {
        id: true,
        code: true,
        slug: true,
        title: true,
        status: true,
        category: true,
        difficulty: true,
        baseStake: true,
        updatedAt: true,
        publishedAt: true,
        _count: { select: { enrollments: true, modules: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const courseIds = courses.map((course) => course.id);

    const [attemptStatusCounts, metrics, perCourseAttempts, reviews, recentActivity] = await Promise.all([
      prisma.courseAttempt.groupBy({
        by: ['status'],
        where: { courseId: { in: courseIds } },
        _count: { _all: true },
      }),
      ReputationService.computeInstructorMetrics(instructorId),
      prisma.courseAttempt.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, status: 'COMPLETED' },
        _avg: { finalScore: true, moduleScore: true, finalTestScore: true },
        _count: { _all: true },
      }),
      prisma.courseReview.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, isPublished: true },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      prisma.courseAttempt.findMany({
        where: { courseId: { in: courseIds } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          attemptNumber: true,
          updatedAt: true,
          finalScore: true,
          user: { select: { id: true, fullName: true, email: true } },
          course: { select: { id: true, title: true, code: true } },
        },
      }),
    ]);

    const attemptStatsByCourse = new Map(perCourseAttempts.map((entry) => [entry.courseId, entry]));
    const reviewStatsByCourse = new Map(reviews.map((entry) => [entry.courseId, entry]));

    const statusCounts = attemptStatusCounts.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.status] = entry._count._all;
      return accumulator;
    }, {});

    const totalSettled = (statusCounts.COMPLETED ?? 0) + (statusCounts.FAILED ?? 0);

    return {
      courses: courses.map((course) => ({
        id: course.id,
        code: course.code,
        slug: course.slug,
        title: course.title,
        status: course.status,
        category: course.category,
        difficulty: course.difficulty,
        baseStake: course.baseStake,
        moduleCount: course._count.modules,
        learnerCount: course._count.enrollments,
        completions: attemptStatsByCourse.get(course.id)?._count._all ?? 0,
        averageScore: roundTo(attemptStatsByCourse.get(course.id)?._avg.finalScore ?? 0, 2),
        averageModuleScore: roundTo(attemptStatsByCourse.get(course.id)?._avg.moduleScore ?? 0, 2),
        averageFinalTestScore: roundTo(attemptStatsByCourse.get(course.id)?._avg.finalTestScore ?? 0, 2),
        averageRating: roundTo(reviewStatsByCourse.get(course.id)?._avg.rating ?? 0, 2),
        ratingCount: reviewStatsByCourse.get(course.id)?._count._all ?? 0,
        publishedAt: course.publishedAt,
        updatedAt: course.updatedAt,
      })),
      overview: {
        totalCourses: courses.length,
        publishedCourses: courses.filter((course) => course.status === 'PUBLISHED').length,
        draftCourses: courses.filter((course) => course.status === 'DRAFT').length,
        totalLearners: metrics.distinctLearners,
        activeAttempts: statusCounts.ACTIVE ?? 0,
        atRiskAttempts: (statusCounts.AT_RISK ?? 0) + (statusCounts.GRACE_PERIOD ?? 0),
        completions: statusCounts.COMPLETED ?? 0,
        failures: statusCounts.FAILED ?? 0,
        completionRate: totalSettled ? roundTo((statusCounts.COMPLETED ?? 0) / totalSettled, 4) : 0,
        averageScore: metrics.averageScore,
        averageRating: metrics.averageRating,
        ratingCount: metrics.ratingCount,
        successfulCommitments: metrics.commitmentSuccesses,
        commitmentSuccessRate: metrics.commitmentSuccessRate,
      },
      reputation: {
        tier: metrics.currentTier,
        eligibleTier: metrics.eligibleTier,
        compositeScore: metrics.compositeScore,
        tierProgress: metrics.tierProgress,
        featuredEligible: metrics.featuredEligible,
        metrics,
      },
      recentActivity,
    };
  },

  async courseAnalytics(courseId: string, actorId: string, role: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        code: true,
        title: true,
        instructorId: true,
        baseStake: true,
        completionReward: true,
        moduleWeight: true,
        finalTestWeight: true,
        maxAttempts: true,
        performanceThreshold: true,
      },
    });
    if (!course) throw notFound('Course');
    if (role !== 'ADMIN' && course.instructorId !== actorId) {
      throw notFound('Course');
    }

    const [enrollments, attempts, reviews, modules] = await Promise.all([
      prisma.enrollment.groupBy({ by: ['status'], where: { courseId }, _count: { _all: true } }),
      prisma.courseAttempt.findMany({
        where: { courseId },
        select: {
          id: true,
          userId: true,
          status: true,
          attemptNumber: true,
          moduleScore: true,
          finalTestScore: true,
          finalScore: true,
          commitmentMet: true,
          pointsAwarded: true,
          pointsForfeited: true,
          startedAt: true,
          completedAt: true,
          failedAt: true,
          stakes: { select: { type: true, status: true, amount: true } },
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.courseReview.findMany({
        where: { courseId, isPublished: true },
        select: { rating: true, difficultyRating: true, wouldRecommend: true, reviewText: true, createdAt: true },
      }),
      prisma.module.findMany({
        where: { courseId },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          title: true,
          orderIndex: true,
          contents: { select: { id: true, isRequired: true, type: true, title: true } },
        },
      }),
    ]);

    const enrollmentCounts = enrollments.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.status] = entry._count._all;
      return accumulator;
    }, {});

    const settled = attempts.filter((attempt) => ['COMPLETED', 'FAILED'].includes(attempt.status));
    const completions = attempts.filter((attempt) => attempt.status === 'COMPLETED');
    const scored = completions.filter((attempt) => attempt.finalScore !== null);

    const commitmentAttempts = attempts.filter((attempt) => attempt.stakes.some((stake) => stake.type === 'COMMITMENT'));
    const commitmentSuccesses = commitmentAttempts.filter((attempt) => attempt.commitmentMet === true);

    // Module-level funnel: how many distinct learners finished each module.
    const moduleFunnel = await Promise.all(
      modules.map(async (module) => {
        const requiredContentIds = module.contents.filter((content) => content.isRequired).map((content) => content.id);
        if (requiredContentIds.length === 0) {
          return { id: module.id, title: module.title, orderIndex: module.orderIndex, completedLearners: 0, completionRate: 0 };
        }

        const learnersCompleted = await prisma.contentProgress.groupBy({
          by: ['userId'],
          where: { contentId: { in: requiredContentIds }, status: 'COMPLETED' },
          _count: { _all: true },
          having: { contentId: { _count: { gte: requiredContentIds.length } } },
        });

        return {
          id: module.id,
          title: module.title,
          orderIndex: module.orderIndex,
          completedLearners: learnersCompleted.length,
          completionRate: enrollmentCounts.ACTIVE || enrollments.length
            ? roundTo(learnersCompleted.length / Math.max(1, attempts.length), 3)
            : 0,
        };
      }),
    );

    const ratingDistribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: reviews.filter((review) => review.rating === rating).length,
    }));

    return {
      course,
      overview: {
        enrolled: enrollments.reduce((sum, entry) => sum + entry._count._all, 0),
        active: (enrollmentCounts.ACTIVE ?? 0),
        completed: enrollmentCounts.COMPLETED ?? 0,
        failed: enrollmentCounts.FAILED ?? 0,
        withdrawn: enrollmentCounts.WITHDRAWN ?? 0,
        completionRate: settled.length ? roundTo(completions.length / settled.length, 4) : 0,
        averageScore: scored.length
          ? roundTo(scored.reduce((sum, attempt) => sum + (attempt.finalScore ?? 0), 0) / scored.length, 2)
          : 0,
        averageModuleScore: scored.length
          ? roundTo(scored.reduce((sum, attempt) => sum + (attempt.moduleScore ?? 0), 0) / scored.length, 2)
          : 0,
        averageFinalTestScore: scored.length
          ? roundTo(scored.reduce((sum, attempt) => sum + (attempt.finalTestScore ?? 0), 0) / scored.length, 2)
          : 0,
        atRisk: attempts.filter((attempt) => ['AT_RISK', 'GRACE_PERIOD'].includes(attempt.status)).length,
        commitmentAttempts: commitmentAttempts.length,
        commitmentSuccesses: commitmentSuccesses.length,
        commitmentSuccessRate: commitmentAttempts.length
          ? roundTo(commitmentSuccesses.length / commitmentAttempts.length, 4)
          : 0,
        pointsAwarded: attempts.reduce((sum, attempt) => sum + attempt.pointsAwarded, 0),
        pointsForfeited: attempts.reduce((sum, attempt) => sum + attempt.pointsForfeited, 0),
        retries: attempts.filter((attempt) => attempt.attemptNumber > 1).length,
      },
      ratings: {
        average: reviews.length ? roundTo(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length, 2) : 0,
        count: reviews.length,
        recommendationRate: reviews.length
          ? roundTo(reviews.filter((review) => review.wouldRecommend).length / reviews.length, 3)
          : 0,
        averageDifficulty: reviews.filter((review) => review.difficultyRating).length
          ? roundTo(
              reviews.reduce((sum, review) => sum + (review.difficultyRating ?? 0), 0) /
                reviews.filter((review) => review.difficultyRating).length,
              2,
            )
          : 0,
        distribution: ratingDistribution,
      },
      moduleFunnel,
      learners: attempts.map((attempt) => ({
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        learner: attempt.user,
        moduleScore: attempt.moduleScore,
        finalTestScore: attempt.finalTestScore,
        finalScore: attempt.finalScore,
        commitmentMet: attempt.commitmentMet,
        pointsAwarded: attempt.pointsAwarded,
        pointsForfeited: attempt.pointsForfeited,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        failedAt: attempt.failedAt,
        stakes: attempt.stakes,
      })),
    };
  },

  /* ---------------------------------------------------------------------- */
  /* Admin                                                                   */
  /* ---------------------------------------------------------------------- */

  async adminDashboard() {
    const [
      usersByRole,
      coursesByStatus,
      walletTotals,
      pool,
      enrollmentStats,
      attemptStats,
      flaggedReviews,
      badgeDistribution,
      recentTransactions,
      recentPoolTransactions,
    ] = await Promise.all([
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.course.groupBy({ by: ['status'], _count: { _all: true } }),
      WalletService.platformTotals(),
      RewardPoolService.getPool(),
      prisma.enrollment.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.courseAttempt.groupBy({ by: ['status'], _count: { _all: true }, _sum: { pointsAwarded: true, pointsForfeited: true } }),
      prisma.courseReview.count({ where: { isFlagged: true } }),
      prisma.instructorBadge.groupBy({ by: ['tier'], where: { isActive: true }, _count: { _all: true } }),
      prisma.walletTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      }),
      prisma.rewardPoolTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const enrollments = enrollmentStats.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.status] = entry._count._all;
      return accumulator;
    }, {});

    const attempts = attemptStats.reduce<Record<string, { count: number; awarded: number; forfeited: number }>>(
      (accumulator, entry) => {
        accumulator[entry.status] = {
          count: entry._count._all,
          awarded: entry._sum.pointsAwarded ?? 0,
          forfeited: entry._sum.pointsForfeited ?? 0,
        };
        return accumulator;
      },
      {},
    );

    const users = usersByRole.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.role] = entry._count._all;
      return accumulator;
    }, {});

    const courses = coursesByStatus.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.status] = entry._count._all;
      return accumulator;
    }, {});

    const badges = badgeDistribution.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.tier] = entry._count._all;
      return accumulator;
    }, {});

    return {
      users: {
        total: usersByRole.reduce((sum, entry) => sum + entry._count._all, 0),
        learners: users.LEARNER ?? 0,
        instructors: users.INSTRUCTOR ?? 0,
        admins: users.ADMIN ?? 0,
      },
      courses: {
        total: coursesByStatus.reduce((sum, entry) => sum + entry._count._all, 0),
        published: courses.PUBLISHED ?? 0,
        draft: courses.DRAFT ?? 0,
        archived: courses.ARCHIVED ?? 0,
      },
      economy: {
        wallet: walletTotals,
        rewardPool: pool,
        pointsAwarded: Object.values(attempts).reduce((sum, entry) => sum + entry.awarded, 0),
        pointsForfeited: Object.values(attempts).reduce((sum, entry) => sum + entry.forfeited, 0),
      },
      enrollments,
      attempts,
      moderation: { flaggedReviews },
      badges: { gold: badges.GOLD ?? 0, silver: badges.SILVER ?? 0, bronze: badges.BRONZE ?? 0, total: badgeDistribution.reduce((sum, entry) => sum + entry._count._all, 0) },
      recentTransactions,
      recentPoolTransactions,
    };
  },

  /** Platform-wide ledger, admin only. */
  async platformTransactions(query: { page?: unknown; pageSize?: unknown; type?: unknown; userId?: unknown }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where = {
      ...(typeof query.type === 'string' && query.type && query.type !== 'ALL' ? { type: query.type as never } : {}),
      ...(typeof query.userId === 'string' && query.userId ? { userId: query.userId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    return paginated(items, total, pagination);
  },
};
