import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { RECOMMENDATION_RULES } from '../config/constants';
import { roundTo } from '../utils/date';

/**
 * Adaptive stake recommendation.
 *
 * V1 is deliberately rule-based (spec §28): the platform *recommends*, it never
 * silently changes a learner's commitment.
 *
 * The `StakeRecommender` interface is the seam for a future ML model — swap the
 * implementation and nothing else in the codebase changes.
 */

export interface LearnerStatistics {
  userId: string;
  totalAttempts: number;
  completions: number;
  failures: number;
  completionRate: number;
  averageScore: number;
  averageAttemptsPerCompletion: number;
  commitmentAttempts: number;
  commitmentSuccessRate: number;
  onTimeRate: number;
}

export interface StakeRecommendation {
  recommendedStake: number;
  recommendedDurationDays: number;
  recommendedCommitmentOptionId: string | null;
  recommendedCommitmentLabel: string | null;
  recommendAccelerated: boolean;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  stance: 'AMBITIOUS' | 'BALANCED' | 'CAUTIOUS' | 'NEUTRAL';
  rationale: string[];
  learnerStatistics: LearnerStatistics;
}

export interface StakeRecommender {
  recommend(params: {
    userId: string;
    courseId: string;
    statistics: LearnerStatistics;
    course: {
      baseStake: number;
      durationDays: number;
      commitmentOptions: Array<{ id: string; label: string; durationDays: number; commitmentStake: number; commitmentBonus: number }>;
    };
  }): Omit<StakeRecommendation, 'learnerStatistics'>;
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                  */
/* -------------------------------------------------------------------------- */

export async function computeLearnerStatistics(userId: string): Promise<LearnerStatistics> {
  const attempts = await prisma.courseAttempt.findMany({
    where: { userId, status: { in: ['COMPLETED', 'FAILED'] } },
    select: {
      id: true,
      status: true,
      attemptNumber: true,
      finalScore: true,
      commitmentMet: true,
      completedAt: true,
      normalDeadline: true,
      stakes: { select: { type: true } },
    },
  });

  const completions = attempts.filter((attempt) => attempt.status === 'COMPLETED');
  const failures = attempts.filter((attempt) => attempt.status === 'FAILED');
  const scored = completions.filter((attempt) => attempt.finalScore !== null);

  const commitmentAttempts = attempts.filter((attempt) => attempt.stakes.some((stake) => stake.type === 'COMMITMENT'));
  const commitmentSuccesses = commitmentAttempts.filter((attempt) => attempt.commitmentMet === true);

  const onTime = completions.filter(
    (attempt) => attempt.completedAt && attempt.completedAt.getTime() <= attempt.normalDeadline.getTime(),
  );

  return {
    userId,
    totalAttempts: attempts.length,
    completions: completions.length,
    failures: failures.length,
    completionRate: attempts.length ? roundTo(completions.length / attempts.length, 4) : 0,
    averageScore: scored.length
      ? roundTo(scored.reduce((sum, attempt) => sum + (attempt.finalScore ?? 0), 0) / scored.length, 2)
      : 0,
    averageAttemptsPerCompletion: completions.length
      ? roundTo(completions.reduce((sum, attempt) => sum + attempt.attemptNumber, 0) / completions.length, 2)
      : 0,
    commitmentAttempts: commitmentAttempts.length,
    commitmentSuccessRate: commitmentAttempts.length
      ? roundTo(commitmentSuccesses.length / commitmentAttempts.length, 4)
      : 0,
    onTimeRate: completions.length ? roundTo(onTime.length / completions.length, 4) : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Rule engine v1                                                              */
/* -------------------------------------------------------------------------- */

export const RuleBasedRecommender: StakeRecommender = {
  recommend({ statistics, course }) {
    const rationale: string[] = [];
    const confident = statistics.totalAttempts >= RECOMMENDATION_RULES.minAttemptsForConfidence;

    let stance: StakeRecommendation['stance'] = 'NEUTRAL';
    let stockMultiplier = 1;
    let durationMultiplier = 1;
    let recommendAccelerated = false;

    if (!confident) {
      stance = 'NEUTRAL';
      durationMultiplier = 1 + RECOMMENDATION_RULES.newLearnerBufferDays / Math.max(1, course.durationDays);
      rationale.push(
        statistics.totalAttempts === 0
          ? 'No history yet — starting with the standard stake and a slightly longer deadline to build momentum.'
          : `Only ${statistics.totalAttempts} settled attempt(s) so far, so the recommendation stays close to the course default.`,
      );
    } else if (
      statistics.completionRate >= RECOMMENDATION_RULES.highPerformerCompletionRate &&
      statistics.averageScore >= RECOMMENDATION_RULES.highPerformerAverageScore &&
      statistics.failures === 0
    ) {
      stance = 'AMBITIOUS';
      stockMultiplier = 1.25;
      durationMultiplier = 0.85;
      recommendAccelerated = true;
      rationale.push(
        `You have completed ${statistics.completions}/${statistics.totalAttempts} staked courses with an average score of ${statistics.averageScore}%.`,
        'A higher stake and a tighter personal deadline are realistic for you.',
      );
    } else if (statistics.completionRate <= RECOMMENDATION_RULES.strugglingCompletionRate) {
      stance = 'CAUTIOUS';
      stockMultiplier = 0.75;
      durationMultiplier = RECOMMENDATION_RULES.strugglingDeadlineMultiplier;
      recommendAccelerated = false;
      rationale.push(
        `You completed ${statistics.completions} of ${statistics.totalAttempts} staked courses. A longer deadline protects your points while you rebuild the habit.`,
        'The accelerated commitment stays off until completion becomes consistent.',
      );
    } else {
      stance = 'BALANCED';
      stockMultiplier = 1;
      durationMultiplier = 1;
      rationale.push(
        `Your completion rate is ${(statistics.completionRate * 100).toFixed(0)}% — the standard commitment looks appropriate.`,
      );
      if (statistics.commitmentAttempts > 0) {
        rationale.push(
          `You have met ${(statistics.commitmentSuccessRate * 100).toFixed(0)}% of your accelerated commitments so far.`,
        );
      }
    }

    const recommendedStake = Math.max(0, Math.round(course.baseStake * stockMultiplier));
    const recommendedDurationDays = Math.max(
      1,
      Math.round(course.durationDays * durationMultiplier),
    );

    // Pick the accelerated option closest to the recommended window.
    const candidateOptions = [...course.commitmentOptions].sort((a, b) => a.durationDays - b.durationDays);
    const closestOption =
      candidateOptions.find((option) => option.durationDays <= recommendedDurationDays) ?? null;

    if (recommendAccelerated && !closestOption && candidateOptions.length > 0) {
      rationale.push('No accelerated option fits the recommended window, so the standard deadline is suggested.');
    }

    if (recommendedStake > course.baseStake) {
      rationale.push(
        `Recommended stake is ${recommendedStake} points (${Math.round((recommendedStake / course.baseStake - 1) * 100)}% above the course base).`,
      );
    } else if (recommendedStake < course.baseStake && course.baseStake > 0) {
      rationale.push(
        `Consider a gentler commitment first — the recommendation is ${recommendedStake} of the ${course.baseStake}-point base.`,
      );
    }

    return {
      recommendedStake,
      recommendedDurationDays,
      recommendAccelerated: Boolean(recommendAccelerated && closestOption),
      recommendedCommitmentOptionId: recommendAccelerated && closestOption ? closestOption.id : null,
      recommendedCommitmentLabel: recommendAccelerated && closestOption ? closestOption.label : null,
      confidence: confident ? 'HIGH' : statistics.totalAttempts > 0 ? 'MEDIUM' : 'LOW',
      stance,
      rationale,
    };
  },
};

/** Swap this binding to plug in a model-backed recommender later. */
let activeRecommender: StakeRecommender = RuleBasedRecommender;

export function setRecommender(recommender: StakeRecommender): void {
  activeRecommender = recommender;
}

export const RecommendationService = {
  async getStatistics(userId: string): Promise<LearnerStatistics> {
    return computeLearnerStatistics(userId);
  },

  /**
   * Recommendation for a specific course. Only ever advisory — the enrolment
   * endpoint still requires the learner to send an explicit commitment.
   */
  async recommendForCourse(userId: string, courseId: string): Promise<StakeRecommendation> {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        commitmentOptions: {
          where: { isActive: true },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, label: true, durationDays: true, commitmentStake: true, commitmentBonus: true },
        },
      },
    });
    if (!course) throw notFound('Course');

    const statistics = await computeLearnerStatistics(userId);

    const recommendation = activeRecommender.recommend({
      userId,
      courseId,
      statistics,
      course: {
        baseStake: course.baseStake,
        durationDays: course.durationDays,
        commitmentOptions: course.commitmentOptions,
      },
    });

    return {
      ...recommendation,
      recommendedStake: Math.max(recommendation.recommendedStake, course.baseStake),
      learnerStatistics: statistics,
    };
  },

  /** Learner-level insights for the wallet/dashboard "how am I doing" panel. */
  async getInsights(userId: string) {
    const statistics = await computeLearnerStatistics(userId);
    const highStakesStreak = statistics.completions > 0 && statistics.failures === 0;

    return {
      ...statistics,
      headline:
        statistics.totalAttempts === 0
          ? 'Stake your first course to start building a track record.'
          : highStakesStreak
            ? `You have completed every staked course so far — a ${statistics.averageScore}% average score.`
            : `Completion rate ${(statistics.completionRate * 100).toFixed(0)}% across ${statistics.totalAttempts} settled attempts.`,
      suggestedStance:
        statistics.totalAttempts === 0
          ? 'NEUTRAL'
          : statistics.completionRate >= RECOMMENDATION_RULES.highPerformerCompletionRate
            ? 'AMBITIOUS'
            : statistics.completionRate <= RECOMMENDATION_RULES.strugglingCompletionRate
              ? 'CAUTIOUS'
              : 'BALANCED',
    };
  },
};
