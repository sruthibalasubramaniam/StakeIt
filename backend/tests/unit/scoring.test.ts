import { describe, expect, it } from 'vitest';
import { computeFinalScore, computeRetryRecoveryReward, isPerformanceBonusEarned } from '../../src/services/completionService';
import { assertValidConfiguration } from '../../src/services/courseService';
import { computeCompositeScore, resolveTier } from '../../src/services/reputationService';
import { gradeQuestions, isPassing, normalizeAnswerMap } from '../../src/lib/grading';

/**
 * These are the calculations the whole reward economy rests on, so they are
 * tested as pure functions without touching the database.
 */
describe('final course score', () => {
  it('applies the documented 70/30 weighting', () => {
    // Spec example: module 86, final test 92, 70/30 → 87.8
    expect(computeFinalScore({ moduleScore: 86, finalTestScore: 92, moduleWeight: 70, finalTestWeight: 30 })).toBe(87.8);
  });

  it('handles a 100% module weighting', () => {
    expect(computeFinalScore({ moduleScore: 74.5, finalTestScore: 0, moduleWeight: 100, finalTestWeight: 0 })).toBe(74.5);
  });

  it('rounds to two decimal places', () => {
    expect(computeFinalScore({ moduleScore: 81, finalTestScore: 88, moduleWeight: 65, finalTestWeight: 35 })).toBe(83.45);
  });

  it('rejects weights that do not total 100%', () => {
    expect(() => computeFinalScore({ moduleScore: 80, finalTestScore: 80, moduleWeight: 60, finalTestWeight: 30 })).toThrow();
    expect(() => computeFinalScore({ moduleScore: 80, finalTestScore: 80, moduleWeight: 110, finalTestWeight: 0 })).toThrow();
  });
});

describe('course configuration validation', () => {
  it('accepts a consistent configuration', () => {
    expect(() =>
      assertValidConfiguration({
        moduleWeight: 70,
        finalTestWeight: 30,
        moduleQuizWeight: 30,
        moduleAssessmentWeight: 70,
        performanceThreshold: 90,
        durationDays: 30,
        gracePeriodHours: 24,
        baseStake: 100,
        completionReward: 50,
      }),
    ).not.toThrow();
  });

  it('rejects module/final weights that miss 100%', () => {
    expect(() =>
      assertValidConfiguration({ moduleWeight: 70, finalTestWeight: 20 }, 'update'),
    ).toThrow(/exactly 100%/);
  });

  it('rejects module quiz/assessment weights that miss 100%', () => {
    expect(() =>
      assertValidConfiguration({ moduleQuizWeight: 30, moduleAssessmentWeight: 60 }, 'update'),
    ).toThrow(/exactly 100%/);
  });

  it('rejects out-of-range thresholds and durations', () => {
    expect(() => assertValidConfiguration({ performanceThreshold: 120 }, 'update')).toThrow();
    expect(() => assertValidConfiguration({ minFinalTestScore: -5 }, 'update')).toThrow();
    expect(() => assertValidConfiguration({ durationDays: 0 }, 'update')).toThrow();
    expect(() => assertValidConfiguration({ requiredWatchPercent: 0 }, 'update')).toThrow();
  });
});

describe('performance bonus', () => {
  it('is awarded at or above the threshold', () => {
    expect(isPerformanceBonusEarned(90, 90)).toBe(true);
    expect(isPerformanceBonusEarned(95.4, 90)).toBe(true);
  });

  it('is withheld below the threshold, without failing the course', () => {
    expect(isPerformanceBonusEarned(89.99, 90)).toBe(false);
    expect(isPerformanceBonusEarned(42, 90)).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(isPerformanceBonusEarned(82, 80)).toBe(true);
    expect(isPerformanceBonusEarned(79, 80)).toBe(false);
  });
});

describe('retry recovery reward', () => {
  it('returns the full stake on the first attempt', () => {
    expect(computeRetryRecoveryReward(100, 1)).toBe(100);
  });

  it('halves the recovery on the second attempt', () => {
    expect(computeRetryRecoveryReward(100, 2)).toBe(50);
  });

  it('floors the division on the third attempt', () => {
    // Spec: 100 / 3 ≈ 33
    expect(computeRetryRecoveryReward(100, 3)).toBe(33);
  });

  it('rejects an invalid attempt number', () => {
    expect(() => computeRetryRecoveryReward(100, 0)).toThrow();
  });
});

describe('quiz / assessment grading', () => {
  const questions = [
    {
      id: 'q1',
      type: 'SINGLE_CHOICE' as const,
      points: 10,
      options: [
        { id: 'a', isCorrect: true },
        { id: 'b', isCorrect: false },
      ],
    },
    {
      id: 'q2',
      type: 'MULTI_CHOICE' as const,
      points: 10,
      options: [
        { id: 'c', isCorrect: true },
        { id: 'd', isCorrect: true },
        { id: 'e', isCorrect: false },
      ],
    },
    {
      id: 'q3',
      type: 'TRUE_FALSE' as const,
      points: 5,
      options: [
        { id: 'f', isCorrect: true },
        { id: 'g', isCorrect: false },
      ],
    },
  ];

  it('awards full marks for entirely correct answers', () => {
    const result = gradeQuestions(questions, { q1: ['a'], q2: ['c', 'd'], q3: ['f'] });
    expect(result.score).toBe(25);
    expect(result.maxScore).toBe(25);
    expect(result.percentage).toBe(100);
    expect(result.correctCount).toBe(3);
    expect(result.hasPendingReview).toBe(false);
  });

  it('gives no partial credit on multi-choice', () => {
    const result = gradeQuestions(questions, { q1: ['a'], q2: ['c'], q3: ['f'] });
    expect(result.score).toBe(15);
    expect(result.results[1]?.correct).toBe(false);
  });

  it('marks unanswered questions wrong rather than crashing', () => {
    const result = gradeQuestions(questions, {});
    expect(result.score).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it('defers subjective answers to review and blocks a pass', () => {
    const result = gradeQuestions(
      [
        { id: 'q1', type: 'SINGLE_CHOICE', points: 10, options: [{ id: 'a', isCorrect: true }] },
        { id: 'q4', type: 'SUBJECTIVE', points: 90, options: [] },
      ],
      { q1: ['a'] },
    );
    expect(result.hasPendingReview).toBe(true);
    expect(result.autoGradedScore).toBe(10);
    // 10/100 would pass a 70% bar if we ignored the ungraded essay.
    expect(result.percentage).toBe(10);
    expect(isPassing(result, 10)).toBe(false);
  });

  it('normalises raw answer payloads', () => {
    expect(normalizeAnswerMap({ q1: 'a', q2: ['b', 'c'], q3: null })).toEqual({ q1: ['a'], q2: ['b', 'c'], q3: [] });
    expect(normalizeAnswerMap(null)).toEqual({});
    expect(normalizeAnswerMap(['not', 'an', 'object'])).toEqual({});
  });
});

describe('instructor reputation', () => {
  it('computes a weighted composite score in 0-100', () => {
    const score = computeCompositeScore({
      completionRate: 0.8,
      averageScore: 85,
      commitmentSuccessRate: 0.7,
      averageRating: 4.5,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('never awards a badge from a tiny sample size', () => {
    const { tier, progress } = resolveTier({
      // Perfect metrics, but only two settled outcomes.
      learnerOutcomes: 2,
      completionRate: 1,
      averageScore: 99,
      commitmentSuccessRate: 1,
      averageRating: 5,
      compositeScore: 99,
    });
    expect(tier).toBe('NONE');
    expect(progress.every((entry) => !entry.eligible)).toBe(true);
  });

  it('awards GOLD only when every requirement is met', () => {
    const { tier } = resolveTier({
      learnerOutcomes: 60,
      completionRate: 0.9,
      averageScore: 90,
      commitmentSuccessRate: 0.8,
      averageRating: 4.8,
      compositeScore: 90,
    });
    expect(tier).toBe('GOLD');
  });

  it('downgrades to BRONZE when only the entry tier is satisfied', () => {
    const { tier, progress } = resolveTier({
      learnerOutcomes: 10,
      completionRate: 0.55,
      averageScore: 68,
      commitmentSuccessRate: 0.45,
      averageRating: 3.6,
      compositeScore: 60,
    });
    expect(tier).toBe('BRONZE');
    expect(progress.find((entry) => entry.tier === 'GOLD')?.eligible).toBe(false);
  });
});
