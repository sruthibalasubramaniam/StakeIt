import { describe, expect, it } from 'vitest';
import {
  computeWatchProgress,
  isValidSegment,
  mergeSegments,
  totalWatchedSeconds,
  validateHeartbeat,
} from '../../src/lib/watchTracking';
import { MAX_PLAYBACK_RATE } from '../../src/config/constants';

const DURATION = 600; // 10 minutes

describe('watch-segment merging', () => {
  it('merges overlapping segments', () => {
    expect(mergeSegments([[0, 10], [5, 20]])).toEqual([[0, 20]]);
  });

  it('merges touching segments', () => {
    expect(mergeSegments([[0, 10], [10, 20]])).toEqual([[0, 20]]);
  });

  it('keeps genuinely disjoint segments apart', () => {
    expect(mergeSegments([[0, 10], [30, 40]])).toEqual([[0, 10], [30, 40]]);
  });

  it('does not double count a re-watched range', () => {
    const merged = mergeSegments([[0, 100], [0, 100], [50, 150]]);
    expect(merged).toEqual([[0, 150]]);
    expect(totalWatchedSeconds(merged)).toBe(150);
  });

  it('discards invalid segments', () => {
    expect(mergeSegments([[10, 10], [20, 5], [-5, 8]])).toEqual([]);
  });

  it('clips segments past the end of the video', () => {
    expect(mergeSegments([[0, 9999]], DURATION)).toEqual([[0, DURATION]]);
  });
});

describe('heartbeat validation', () => {
  it('accepts honest forward playback', () => {
    const result = validateHeartbeat({ fromSeconds: 0, toSeconds: 10, elapsedRealSeconds: 10, durationSeconds: DURATION });
    expect(result.suspicious).toBe(false);
    expect(result.segment).toEqual([0, 10]);
  });

  it('accepts playback at the maximum permitted rate', () => {
    const result = validateHeartbeat({
      fromSeconds: 100,
      toSeconds: 100 + 10 * MAX_PLAYBACK_RATE,
      elapsedRealSeconds: 10,
      durationSeconds: DURATION,
    });
    expect(result.suspicious).toBe(false);
  });

  it('REFUSES to credit a scrub from the start to the end of the video', () => {
    // The classic cheat: drag the playhead from 0 to 590 in one second.
    const heartbeat = validateHeartbeat({
      fromSeconds: 0,
      toSeconds: 590,
      elapsedRealSeconds: 1,
      durationSeconds: DURATION,
    });

    expect(heartbeat.suspicious).toBe(true);
    expect(heartbeat.reason).toMatch(/Credited only/);

    // Only the physically possible time is credited, so the completion
    // threshold stays far out of reach.
    const credited = heartbeat.segment ?? [0, 0];
    expect(credited[1] - credited[0]).toBeLessThanOrEqual(1 * MAX_PLAYBACK_RATE);

    const progress = computeWatchProgress({
      existingSegments: [],
      newSegment: heartbeat.segment,
      durationSeconds: DURATION,
      requiredPercent: 90,
    });
    expect(progress.validPercent).toBeLessThan(1);
    expect(progress.isComplete).toBe(false);
  });

  it('still completes a video that was genuinely watched in one sitting', () => {
    // 10 minutes of media over 10 minutes of real time.
    const heartbeat = validateHeartbeat({
      fromSeconds: 0,
      toSeconds: DURATION,
      elapsedRealSeconds: DURATION,
      durationSeconds: DURATION,
    });
    expect(heartbeat.suspicious).toBe(false);

    const progress = computeWatchProgress({
      existingSegments: [],
      newSegment: heartbeat.segment,
      durationSeconds: DURATION,
      requiredPercent: 90,
    });
    expect(progress.isComplete).toBe(true);
  });

  it('credits only the physically possible portion of an over-claim', () => {
    // 40s claimed, 20s of real playback time available at 2.5x → expect 50s.
    const result = validateHeartbeat({
      fromSeconds: 0,
      toSeconds: 40,
      elapsedRealSeconds: 20,
      durationSeconds: DURATION,
    });
    expect(result.suspicious).toBe(false);
    expect(result.segment).toEqual([0, 40]);

    const overClaim = validateHeartbeat({
      fromSeconds: 0,
      toSeconds: 200,
      elapsedRealSeconds: 20,
      durationSeconds: DURATION,
    });
    expect(overClaim.suspicious).toBe(true);
    expect(overClaim.segment).toEqual([0, 20 * MAX_PLAYBACK_RATE]);
  });

  it('ignores rewinds and pauses', () => {
    expect(validateHeartbeat({ fromSeconds: 200, toSeconds: 100, elapsedRealSeconds: 30, durationSeconds: DURATION }).segment).toBeNull();
    expect(validateHeartbeat({ fromSeconds: 100, toSeconds: 100, elapsedRealSeconds: 30, durationSeconds: DURATION }).segment).toBeNull();
  });

  it('rejects non-numeric positions', () => {
    expect(isValidSegment([Number.NaN, 10], DURATION)).toBe(false);
    expect(isValidSegment([0, Number.POSITIVE_INFINITY], DURATION)).toBe(false);
  });
});

describe('valid-watch completion', () => {
  it('reports 0% for an empty history', () => {
    const progress = computeWatchProgress({ existingSegments: [], newSegment: null, durationSeconds: DURATION, requiredPercent: 90 });
    expect(progress.validPercent).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it('does not complete at 65% when 90% is required', () => {
    const progress = computeWatchProgress({
      existingSegments: [[0, 390]],
      newSegment: null,
      durationSeconds: DURATION,
      requiredPercent: 90,
    });
    expect(progress.validPercent).toBeCloseTo(65, 1);
    expect(progress.isComplete).toBe(false);
  });

  it('completes exactly at the requirement', () => {
    const progress = computeWatchProgress({
      existingSegments: [[0, 540]],
      newSegment: null,
      durationSeconds: DURATION,
      requiredPercent: 90,
    });
    expect(progress.validPercent).toBe(90);
    expect(progress.isComplete).toBe(true);
  });

  it('cannot reach 90% by watching a few short disjoint slices', () => {
    const progress = computeWatchProgress({
      existingSegments: [[0, 20], [100, 120], [300, 320]],
      newSegment: null,
      durationSeconds: DURATION,
      requiredPercent: 90,
    });
    expect(progress.watchedSeconds).toBe(60);
    expect(progress.isComplete).toBe(false);
  });

  it('never reports more watched time than the video is long', () => {
    const progress = computeWatchProgress({
      existingSegments: [[0, 300], [150, 500], [400, 900]],
      newSegment: [500, 700],
      durationSeconds: DURATION,
      requiredPercent: 90,
    });
    expect(progress.watchedSeconds).toBeLessThanOrEqual(DURATION);
    expect(progress.validPercent).toBe(100);
  });

  it('honours a custom requirement configured by the instructor', () => {
    const progress = computeWatchProgress({
      existingSegments: [[0, 420]],
      newSegment: null,
      durationSeconds: DURATION,
      requiredPercent: 70,
    });
    expect(progress.validPercent).toBe(70);
    expect(progress.isComplete).toBe(true);
  });

  it('treats a zero-duration video as never complete', () => {
    const progress = computeWatchProgress({ existingSegments: [[0, 10]], newSegment: null, durationSeconds: 0, requiredPercent: 90 });
    expect(progress.validPercent).toBe(0);
    expect(progress.isComplete).toBe(false);
  });
});
