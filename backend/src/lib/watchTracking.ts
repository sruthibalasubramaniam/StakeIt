/**
 * Valid-watch tracking.
 *
 * The rule: a learner may NOT reach 90% by dragging the scrubber to the end.
 * The client reports *segments* it actually played. The server:
 *
 *   1. rejects impossible segments (negative, inverted, beyond the video);
 *   2. trims any segment that claims more forward progress than the elapsed
 *      wall-clock time could physically allow (`MAX_PLAYBACK_RATE`);
 *   3. merges overlapping segments so re-watching does not double count;
 *   4. computes the union length, which is the only number that can mark a
 *      video complete.
 *
 * These functions are pure so the critical arithmetic is unit-testable
 * without a database.
 */
import { MAX_PLAYBACK_RATE, MIN_TRACKED_SEGMENT_SECONDS } from '../config/constants';

export type Segment = [number, number];

export interface HeartbeatInput {
  /** Playhead position when the previous heartbeat was sent. */
  fromSeconds: number;
  /** Playhead position now. */
  toSeconds: number;
  /** Seconds of wall-clock time elapsed since the previous heartbeat. */
  elapsedRealSeconds: number;
  durationSeconds: number;
}

export interface HeartbeatResult {
  /** The accepted (possibly trimmed) segment, or null when rejected. */
  segment: Segment | null;
  /** True when the client claimed more progress than wall-clock time allows. */
  suspicious: boolean;
  reason?: string;
}

export function isValidSegment(segment: Segment, durationSeconds: number): boolean {
  const [start, end] = segment;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start < 0 || end < 0) return false;
  if (end <= start) return false;
  if (durationSeconds > 0 && start > durationSeconds + 1) return false;
  return end - start >= 0;
}

/**
 * Validates a single heartbeat against physical playback limits.
 *
 * A learner watching at 2x still only advances 2 seconds of media per second
 * of real time, so `elapsedRealSeconds * MAX_PLAYBACK_RATE` is the ceiling for
 * honest forward progress. Anything beyond that is trimmed rather than
 * credited, which neutralises scrub-to-end without punishing seeks backwards
 * or normal buffering.
 */
export function validateHeartbeat(input: HeartbeatInput): HeartbeatResult {
  const { fromSeconds, toSeconds, elapsedRealSeconds, durationSeconds } = input;

  const start = Math.max(0, Math.min(fromSeconds, durationSeconds || fromSeconds));
  const end = Math.max(0, Math.min(toSeconds, durationSeconds || toSeconds));

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { segment: null, suspicious: false, reason: 'Non-numeric position' };
  }

  if (end <= start) {
    // Rewind or pause — nothing to credit, but not suspicious either.
    return { segment: null, suspicious: false, reason: 'No forward progress' };
  }

  const claimed = end - start;
  const allowed = Math.max(0, elapsedRealSeconds) * MAX_PLAYBACK_RATE;

  if (claimed > allowed) {
    const creditedEnd = start + allowed;
    if (creditedEnd - start < MIN_TRACKED_SEGMENT_SECONDS) {
      return {
        segment: null,
        suspicious: true,
        reason: `Skipped ${claimed.toFixed(1)}s but only ${allowed.toFixed(1)}s of playback time was available.`,
      };
    }
    return {
      segment: [start, creditedEnd],
      suspicious: true,
      reason: `Credited only ${allowed.toFixed(1)}s of the claimed ${claimed.toFixed(1)}s.`,
    };
  }

  return { segment: [start, end], suspicious: false };
}

/** Sorts, clips and merges overlapping/adjacent segments into a disjoint set. */
export function mergeSegments(segments: Segment[], durationSeconds?: number): Segment[] {
  const cleaned = segments
    .filter((segment) => Array.isArray(segment) && segment.length === 2)
    .map((segment) => [Number(segment[0]), Number(segment[1])] as Segment)
    .filter(
      (segment) =>
        Number.isFinite(segment[0]) &&
        Number.isFinite(segment[1]) &&
        // A negative start means a malformed client payload: reject it outright
        // rather than silently shifting the segment into valid range.
        segment[0] >= 0 &&
        segment[1] > segment[0],
    )
    .map((segment) => [
      segment[0],
      durationSeconds ? Math.min(segment[1], durationSeconds) : segment[1],
    ] as Segment)
    .filter((segment) => segment[1] > segment[0])
    .sort((a, b) => a[0] - b[0]);

  const merged: Segment[] = [];
  for (const segment of cleaned) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push([...segment] as Segment);
      continue;
    }
    // Adjacent (touching) segments are merged too: 0-10 + 10-20 === 0-20.
    if (segment[0] <= last[1] + 0.25) {
      last[1] = Math.max(last[1], segment[1]);
    } else {
      merged.push([...segment] as Segment);
    }
  }
  return merged;
}

export function totalWatchedSeconds(segments: Segment[]): number {
  return segments.reduce((sum, [start, end]) => sum + (end - start), 0);
}

export interface WatchProgress {
  segments: Segment[];
  watchedSeconds: number;
  validPercent: number;
  isComplete: boolean;
}

/**
 * The single source of truth for "has this video been watched enough?".
 */
export function computeWatchProgress(params: {
  existingSegments: Segment[];
  newSegment: Segment | null;
  durationSeconds: number;
  requiredPercent: number;
}): WatchProgress {
  const segments = mergeSegments(
    params.newSegment ? [...params.existingSegments, params.newSegment] : params.existingSegments,
    params.durationSeconds || undefined,
  );
  const watchedSeconds = totalWatchedSeconds(segments);
  const validPercent = params.durationSeconds > 0 ? (watchedSeconds / params.durationSeconds) * 100 : 0;

  return {
    segments,
    watchedSeconds: Math.round(watchedSeconds * 100) / 100,
    validPercent: Math.round(validPercent * 100) / 100,
    isComplete: params.durationSeconds > 0 && validPercent >= params.requiredPercent,
  };
}

/**
 * Estimated progress while a long video is still playing, used for the
 * "65% watched (90% required to complete)" readout.
 */
export function describeWatchProgress(progress: WatchProgress, requiredPercent: number): string {
  return `${progress.validPercent.toFixed(0)}% watched (${requiredPercent}% required to complete)`;
}
