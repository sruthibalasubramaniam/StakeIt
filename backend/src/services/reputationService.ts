import type { BadgeTier, Prisma } from '@prisma/client';
import { prisma, withTransaction } from '../lib/prisma';
import { notFound } from '../lib/errors';
import {
  REPUTATION_MARKET_WEIGHTS,
  REPUTATION_TIERS,
  REPUTATION_WEIGHTS,
  type ReputationTierConfig,
} from '../config/constants';
import { roundTo } from '../utils/date';
import { NotificationService } from './notificationService';

export interface InstructorMetrics {
  instructorId: string;
  instructorName: string;
  courseCount: number;
  publishedCourseCount: number;
  /** Learners with at least one settled (completed or failed) attempt. */
  learnerOutcomes: number;
  distinctLearners: number;
  completions: number;
  failures: number;
  completionRate: number;
  averageScore: number;
  commitmentAttempts: number;
  commitmentSuccesses: number;
  commitmentSuccessRate: number;
  averageRating: number;
  ratingCount: number;
  recommendationRate: number;
  compositeScore: number;
  eligibleTier: BadgeTier;
  currentTier: BadgeTier;
  tierProgress: Array<{ tier: BadgeTier; eligible: boolean; missing: string[] }>;
  featuredEligible: boolean;
}

/**
 * Weighted 0-100 reputation composite. Ratings are 1-5 and normalised to
 * 0-100 so every component carries comparable weight.
 */
export function computeCompositeScore(metrics: {
  completionRate: number;
  averageScore: number;
  commitmentSuccessRate: number;
  averageRating: number;
}): number {
  const normalisedRating = (metrics.averageRating / 5) * 100;
  const composite =
    metrics.completionRate * 100 * REPUTATION_WEIGHTS.completionRate +
    metrics.averageScore * REPUTATION_WEIGHTS.averageScore +
    metrics.commitmentSuccessRate * 100 * REPUTATION_WEIGHTS.commitmentSuccessRate +
    normalisedRating * REPUTATION_WEIGHTS.averageRating;

  return roundTo(composite, 2);
}

/**
 * Resolves the highest tier an instructor qualifies for.
 *
 * The `minLearnerOutcomes` gate is what stops a brand-new instructor with two
 * perfect completions from being labelled GOLD.
 */
export function resolveTier(
  metrics: {
    learnerOutcomes: number;
    completionRate: number;
    averageScore: number;
    commitmentSuccessRate: number;
    averageRating: number;
    compositeScore: number;
  },
  tiers: ReputationTierConfig[] = REPUTATION_TIERS,
): { tier: BadgeTier; progress: Array<{ tier: BadgeTier; eligible: boolean; missing: string[] }> } {
  const evaluate = (config: ReputationTierConfig) => {
    const missing: string[] = [];
    if (metrics.learnerOutcomes < config.minLearnerOutcomes) {
      missing.push(`needs ${config.minLearnerOutcomes - metrics.learnerOutcomes} more settled learner outcome(s)`);
    }
    if (metrics.completionRate < config.minCompletionRate) missing.push('completion rate below threshold');
    if (metrics.averageScore < config.minAverageScore) missing.push('average learner score below threshold');
    if (metrics.commitmentSuccessRate < config.minCommitmentSuccessRate) {
      missing.push('commitment success rate below threshold');
    }
    if (metrics.averageRating < config.minAverageRating) missing.push('learner rating below threshold');
    if (metrics.compositeScore < config.minCompositeScore) missing.push('composite reputation score below threshold');
    return { eligible: missing.length === 0, missing };
  };

  const progress = tiers.map((config) => ({ tier: config.tier, ...evaluate(config) }));
  const tier = progress.find((entry) => entry.eligible)?.tier ?? 'NONE';

  return { tier, progress };
}

export const ReputationService = {
  /** Full metric set for one instructor, computed from settled learner outcomes. */
  async computeInstructorMetrics(instructorId: string): Promise<InstructorMetrics> {
    const instructor = await prisma.user.findUnique({
      where: { id: instructorId },
      select: { id: true, fullName: true },
    });
    if (!instructor) throw notFound('Instructor');

    const courses = await prisma.course.findMany({
      where: { instructorId },
      select: { id: true, status: true },
    });
    const courseIds = courses.map((course) => course.id);

    if (courseIds.length === 0) {
      const empty = {
        instructorId,
        instructorName: instructor.fullName,
        courseCount: 0,
        publishedCourseCount: 0,
        learnerOutcomes: 0,
        distinctLearners: 0,
        completions: 0,
        failures: 0,
        completionRate: 0,
        averageScore: 0,
        commitmentAttempts: 0,
        commitmentSuccesses: 0,
        commitmentSuccessRate: 0,
        averageRating: 0,
        ratingCount: 0,
        recommendationRate: 0,
        compositeScore: 0,
        eligibleTier: 'NONE' as BadgeTier,
        currentTier: 'NONE' as BadgeTier,
        tierProgress: REPUTATION_TIERS.map((config) => ({
          tier: config.tier,
          eligible: false,
          missing: [`needs ${config.minLearnerOutcomes} settled learner outcome(s)`],
        })),
        featuredEligible: false,
      };
      return empty;
    }

    // Settled = the learner either finished (COMPLETED) or burned an attempt (FAILED).
    const settledAttempts = await prisma.courseAttempt.findMany({
      where: { courseId: { in: courseIds }, status: { in: ['COMPLETED', 'FAILED'] } },
      select: {
        id: true,
        userId: true,
        status: true,
        finalScore: true,
        commitmentMet: true,
        acceleratedDeadline: true,
        stakes: { select: { type: true } },
      },
    });

    const reviews = await prisma.courseReview.findMany({
      where: { courseId: { in: courseIds }, isPublished: true },
      select: { rating: true, wouldRecommend: true },
    });

    const completions = settledAttempts.filter((attempt) => attempt.status === 'COMPLETED');
    const failures = settledAttempts.filter((attempt) => attempt.status === 'FAILED');

    const scored = completions.filter((attempt) => attempt.finalScore !== null);
    const averageScore = scored.length
      ? roundTo(scored.reduce((sum, attempt) => sum + (attempt.finalScore ?? 0), 0) / scored.length, 2)
      : 0;

    const commitmentAttempts = settledAttempts.filter((attempt) =>
      attempt.stakes.some((stake) => stake.type === 'COMMITMENT'),
    );
    const commitmentSuccesses = commitmentAttempts.filter((attempt) => attempt.commitmentMet === true);

    const averageRating = reviews.length
      ? roundTo(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length, 2)
      : 0;
    const recommendationRate = reviews.length
      ? roundTo(reviews.filter((review) => review.wouldRecommend).length / reviews.length, 3)
      : 0;

    const completionRate = settledAttempts.length ? roundTo(completions.length / settledAttempts.length, 4) : 0;
    const commitmentSuccessRate = commitmentAttempts.length
      ? roundTo(commitmentSuccesses.length / commitmentAttempts.length, 4)
      : 0;

    const compositeScore = computeCompositeScore({
      completionRate,
      // A missing average is treated as a neutral 70 rather than 0, so an
      // instructor is not punished for having ungraded cohorts.
      averageScore: averageScore || (settledAttempts.length ? 70 : 0),
      commitmentSuccessRate,
      averageRating: averageRating || (reviews.length ? 3.5 : 0),
    });

    const { tier, progress } = resolveTier({
      learnerOutcomes: settledAttempts.length,
      completionRate,
      averageScore: averageScore || (settledAttempts.length ? 70 : 0),
      commitmentSuccessRate,
      averageRating: averageRating || (reviews.length ? 3.5 : 0),
      compositeScore,
    });

    const activeBadge = await prisma.instructorBadge.findFirst({
      where: { instructorId, isActive: true },
      orderBy: { awardedAt: 'desc' },
    });

    return {
      instructorId,
      instructorName: instructor.fullName,
      courseCount: courses.length,
      publishedCourseCount: courses.filter((course) => course.status === 'PUBLISHED').length,
      learnerOutcomes: settledAttempts.length,
      distinctLearners: new Set(settledAttempts.map((attempt) => attempt.userId)).size,
      completions: completions.length,
      failures: failures.length,
      completionRate,
      averageScore,
      commitmentAttempts: commitmentAttempts.length,
      commitmentSuccesses: commitmentSuccesses.length,
      commitmentSuccessRate,
      averageRating,
      ratingCount: reviews.length,
      recommendationRate,
      compositeScore,
      eligibleTier: tier,
      currentTier: activeBadge?.tier ?? 'NONE',
      tierProgress: progress,
      featuredEligible: compositeScore >= REPUTATION_MARKET_WEIGHTS.featuredEligibilityComposite,
    };
  },

  /** Persists the computed tier and notifies the instructor when it improves. */
  async syncBadge(instructorId: string, awardedById?: string) {
    const metrics = await this.computeInstructorMetrics(instructorId);

    const rank: Record<BadgeTier, number> = { NONE: 0, BRONZE: 1, SILVER: 2, GOLD: 3 };

    return withTransaction(async (tx) => {
      const existing = await tx.instructorBadge.findFirst({
        where: { instructorId, isActive: true },
        orderBy: { awardedAt: 'desc' },
      });

      if (rank[metrics.eligibleTier] <= rank[existing?.tier ?? 'NONE']) {
        return { instructorId, tier: existing?.tier ?? 'NONE', changed: false, metrics };
      }

      if (existing) {
        await tx.instructorBadge.update({ where: { id: existing.id }, data: { isActive: false } });
      }

      const badge = await tx.instructorBadge.create({
        data: {
          instructorId,
          tier: metrics.eligibleTier,
          isActive: true,
          metrics: metrics as unknown as Prisma.InputJsonValue,
          awardedById: awardedById ?? null,
          notes: 'Automatically awarded by ReputationService',
        },
      });

      await NotificationService.notify(tx, {
        userId: instructorId,
        type: 'INSTRUCTOR_BADGE',
        title: `${metrics.eligibleTier} reputation badge awarded`,
        message: `Your courses now hold a ${metrics.eligibleTier} reputation tier (composite score ${metrics.compositeScore}).`,
        link: '/instructor/dashboard',
        metadata: { referenceId: badge.id },
      });

      return { instructorId, tier: metrics.eligibleTier, changed: true, metrics };
    });
  },

  /** Recomputes every instructor — used by the nightly job. */
  async recomputeAllBadges(): Promise<Array<{ instructorId: string; tier: BadgeTier; changed: boolean }>> {
    const instructors = await prisma.user.findMany({ where: { role: 'INSTRUCTOR' }, select: { id: true } });
    const results: Array<{ instructorId: string; tier: BadgeTier; changed: boolean }> = [];

    for (const instructor of instructors) {
      const result = await this.syncBadge(instructor.id);
      results.push({ instructorId: instructor.id, tier: result.tier, changed: result.changed });
    }
    return results;
  },

  /** Public reputation summary embedded in course detail responses. */
  async getPublicReputation(instructorId: string) {
    const badges = await prisma.instructorBadge.findMany({
      where: { instructorId },
      orderBy: { awardedAt: 'desc' },
    });
    const active = badges.find((badge) => badge.isActive);
    const metrics = await this.computeInstructorMetrics(instructorId);

    return {
      tier: active?.tier ?? 'NONE',
      awardedAt: active?.awardedAt ?? null,
      completionRate: metrics.completionRate,
      averageScore: metrics.averageScore,
      averageRating: metrics.averageRating,
      learnerOutcomes: metrics.learnerOutcomes,
      compositeScore: metrics.compositeScore,
    };
  },

  /** Admin override: grant or revoke a badge explicitly. */
  async overrideBadge(params: {
    instructorId: string;
    tier: BadgeTier;
    actorId: string;
    notes?: string;
    isActive?: boolean;
  }) {
    const instructor = await prisma.user.findUnique({ where: { id: params.instructorId } });
    if (!instructor) throw notFound('Instructor');

    return withTransaction(async (tx) => {
      const active = await tx.instructorBadge.findFirst({
        where: { instructorId: params.instructorId, isActive: true },
      });
      if (active) await tx.instructorBadge.update({ where: { id: active.id }, data: { isActive: false } });

      if (params.tier === 'NONE') {
        return { instructorId: params.instructorId, tier: 'NONE' as BadgeTier, revoked: true };
      }

      const badge = await tx.instructorBadge.create({
        data: {
          instructorId: params.instructorId,
          tier: params.tier,
          isActive: params.isActive ?? true,
          notes: params.notes ?? 'Manual administrator adjustment',
          awardedById: params.actorId,
        },
      });

      await NotificationService.notify(tx, {
        userId: params.instructorId,
        type: 'INSTRUCTOR_BADGE',
        title: `${params.tier} badge granted by an administrator`,
        message: params.notes ?? 'An administrator updated your reputation badge.',
        link: '/instructor/profile',
        metadata: { referenceId: badge.id },
      });

      return { instructorId: params.instructorId, tier: params.tier, revoked: false, badgeId: badge.id };
    });
  },

  async listBadges(query: { tier?: string } = {}) {
    return prisma.instructorBadge.findMany({
      where: {
        ...(query.tier && query.tier !== 'ALL' ? { tier: query.tier as BadgeTier } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { awardedAt: 'desc' }],
      include: { instructor: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    });
  },

  async getBadgeHistory(instructorId: string) {
    return prisma.instructorBadge.findMany({
      where: { instructorId },
      orderBy: { awardedAt: 'desc' },
    });
  },
};
