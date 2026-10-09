import { describe, expect, it } from 'vitest';
import { computeUnlocks, progressPercent } from '../../src/lib/sequence';
import { computePacing } from '../../src/lib/pacing';
import { addDays, addHours, daysRemaining } from '../../src/utils/date';

/**
 * Strict sequential unlocking is the platform's core business rule: the quiz
 * stays locked until the video is complete, and Module 2 stays locked until
 * Module 1's assessment passes.
 */
describe('sequential unlocking', () => {
  const course = [
    { id: 'm1-video', isRequired: true },
    { id: 'm1-quiz', isRequired: true },
    { id: 'm1-assessment', isRequired: true },
    { id: 'm2-video', isRequired: true },
    { id: 'm2-quiz', isRequired: true },
    { id: 'm2-assessment', isRequired: true },
    { id: 'final', isRequired: true },
  ];

  it('unlocks only the first item on a fresh attempt', () => {
    const { unlocked, firstIncompleteId } = computeUnlocks(course, []);
    expect([...unlocked]).toEqual(['m1-video']);
    expect(firstIncompleteId).toBe('m1-video');
  });

  it('keeps the quiz locked while the video is incomplete', () => {
    const { unlocked } = computeUnlocks(course, []);
    expect(unlocked.has('m1-quiz')).toBe(false);
  });

  it('unlocks the quiz exactly when the video completes', () => {
    const { unlocked, firstIncompleteId } = computeUnlocks(course, ['m1-video']);
    expect(unlocked.has('m1-quiz')).toBe(true);
    expect(unlocked.has('m1-assessment')).toBe(false);
    expect(firstIncompleteId).toBe('m1-quiz');
  });

  it('keeps the module assessment locked while the quiz is incomplete', () => {
    const { unlocked } = computeUnlocks(course, ['m1-video']);
    expect(unlocked.has('m1-assessment')).toBe(false);
  });

  it('keeps Module 2 locked until the Module 1 assessment completes', () => {
    const { unlocked } = computeUnlocks(course, ['m1-video', 'm1-quiz']);
    expect(unlocked.has('m2-video')).toBe(false);
    expect(unlocked.has('final')).toBe(false);
  });

  it('unlocks Module 2 only after the full Module 1 chain', () => {
    const { unlocked, firstIncompleteId } = computeUnlocks(course, ['m1-video', 'm1-quiz', 'm1-assessment']);
    expect(unlocked.has('m2-video')).toBe(true);
    expect(unlocked.has('m2-quiz')).toBe(false);
    expect(firstIncompleteId).toBe('m2-video');
  });

  it('keeps the final test locked until every module is complete', () => {
    const { unlocked } = computeUnlocks(course, ['m1-video', 'm1-quiz', 'm1-assessment', 'm2-video', 'm2-quiz']);
    expect(unlocked.has('m2-assessment')).toBe(true);
    expect(unlocked.has('final')).toBe(false);
  });

  it('unlocks the final test once all modules are complete', () => {
    const completed = ['m1-video', 'm1-quiz', 'm1-assessment', 'm2-video', 'm2-quiz', 'm2-assessment'];
    const { unlocked, firstIncompleteId } = computeUnlocks(course, completed);
    expect(unlocked.has('final')).toBe(true);
    expect(firstIncompleteId).toBe('final');
  });

  it('reports nothing outstanding once everything is complete', () => {
    const { firstIncompleteId } = computeUnlocks(course, course.map((entry) => entry.id));
    expect(firstIncompleteId).toBeNull();
  });

  it('lets optional items be skipped without blocking progress', () => {
    const withOptional = [
      { id: 'a', isRequired: true },
      { id: 'b-optional', isRequired: false },
      { id: 'c', isRequired: true },
    ];
    const { unlocked } = computeUnlocks(withOptional, ['a']);
    // Optional item does not block, so `c` opens as soon as `a` is done.
    expect(unlocked.has('b-optional')).toBe(true);
    expect(unlocked.has('c')).toBe(true);
  });
});

describe('progress percentage', () => {
  it('counts only required items', () => {
    expect(progressPercent(['a', 'b', 'c', 'd'], ['a', 'b'])).toBe(50);
  });

  it('returns 100 when everything required is done', () => {
    expect(progressPercent(['a', 'b'], ['a', 'b', 'extra'])).toBe(100);
  });

  it('handles a course with no required items', () => {
    expect(progressPercent([], ['a'])).toBe(0);
  });

  it('rounds to one decimal place', () => {
    expect(progressPercent(['a', 'b', 'c'], ['a'])).toBe(33.3);
  });
});

describe('pacing and at-risk detection', () => {
  const now = new Date('2026-03-20T12:00:00Z');

  it('flags a learner behind expected progress', () => {
    // 30-day window with 20 days elapsed → 67% expected, 40% actual.
    const pacing = computePacing({
      startedAt: addDays(now, -20),
      normalDeadline: addDays(now, 10),
      graceDeadline: addHours(addDays(now, 10), 24),
      actualProgressPercent: 40,
      now,
    });
    expect(pacing.expectedProgressPercent).toBeGreaterThan(60);
    expect(pacing.isAtRisk).toBe(true);
    expect(pacing.riskLevel).toBe('AT_RISK');
    expect(pacing.riskLabel).toBe('At Risk');
  });

  it('reports ON_TRACK when ahead of schedule', () => {
    const pacing = computePacing({
      startedAt: addDays(now, -10),
      normalDeadline: addDays(now, 20),
      graceDeadline: addHours(addDays(now, 20), 24),
      actualProgressPercent: 55,
      now,
    });
    expect(pacing.isAtRisk).toBe(false);
    expect(pacing.riskLevel).toBe('ON_TRACK');
    expect(pacing.gap).toBeLessThanOrEqual(0);
  });

  it('reports STEADY for a small shortfall below the risk threshold', () => {
    const pacing = computePacing({
      startedAt: addDays(now, -15),
      normalDeadline: addDays(now, 15),
      graceDeadline: addHours(addDays(now, 15), 24),
      actualProgressPercent: 45,
      now,
    });
    expect(pacing.gap).toBeGreaterThan(0);
    expect(pacing.gap).toBeLessThan(15);
    expect(pacing.riskLevel).toBe('STEADY');
    expect(pacing.isAtRisk).toBe(false);
  });

  it('moves into GRACE_PERIOD once the deadline passes', () => {
    const pacing = computePacing({
      startedAt: addDays(now, -31),
      normalDeadline: addHours(now, -6),
      graceDeadline: addHours(now, 18),
      actualProgressPercent: 90,
      now,
    });
    expect(pacing.deadlineMissed).toBe(true);
    expect(pacing.inGracePeriod).toBe(true);
    expect(pacing.riskLevel).toBe('GRACE_PERIOD');
    expect(pacing.hoursUntilForfeiture).toBeCloseTo(18, 0);
  });

  it('reports FAILED after the grace period elapses', () => {
    const pacing = computePacing({
      startedAt: addDays(now, -33),
      normalDeadline: addDays(now, -3),
      graceDeadline: addHours(addDays(now, -3), 24),
      actualProgressPercent: 30,
      now,
    });
    expect(pacing.deadlineMissed).toBe(true);
    expect(pacing.inGracePeriod).toBe(false);
    expect(pacing.riskLevel).toBe('FAILED');
  });

  it('tracks the accelerated deadline separately from the normal one', () => {
    const pacing = computePacing({
      startedAt: addDays(now, -20),
      normalDeadline: addDays(now, 10),
      acceleratedDeadline: addDays(now, -2),
      graceDeadline: addHours(addDays(now, 10), 24),
      actualProgressPercent: 70,
      now,
    });
    expect(pacing.acceleratedDeadlineMissed).toBe(true);
    expect(pacing.daysRemaining).toBe(10);
    // Missing the personal deadline must not, by itself, fail the course.
    expect(pacing.riskLevel).not.toBe('FAILED');
  });

  it('honours a custom at-risk threshold', () => {
    const base = {
      startedAt: addDays(now, -15),
      normalDeadline: addDays(now, 15),
      graceDeadline: addHours(addDays(now, 15), 24),
      actualProgressPercent: 40,
      now,
    };
    // gap = 50% expected − 40% actual = 10 points
    expect(computePacing({ ...base, atRiskThresholdPercent: 25 }).isAtRisk).toBe(false);
    expect(computePacing({ ...base, atRiskThresholdPercent: 5 }).isAtRisk).toBe(true);
  });
});

describe('date helpers', () => {
  it('never reports negative days remaining', () => {
    expect(daysRemaining(addDays(new Date(), -5))).toBe(0);
  });

  it('rounds remaining days up', () => {
    expect(daysRemaining(addHours(new Date(), 30))).toBe(2);
  });
});
