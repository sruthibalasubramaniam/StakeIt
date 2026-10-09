/**
 * Pacing / at-risk calculation.
 *
 * Expected progress is derived from the share of the course window that has
 * already elapsed; actual progress comes from verified completions. The gap
 * between the two drives the "AT RISK" state that the learner dashboard
 * surfaces (progress, expected progress, deadline, days remaining, active
 * stake, potential reward).
 *
 * Pure functions — unit tested without a database.
 */
import { AT_RISK_THRESHOLD_PERCENT_FALLBACK, type RiskLevel } from './pacing.types';
import { clamp, daysRemaining, elapsedFraction, MS_PER_HOUR, roundTo } from '../utils/date';

export type { RiskLevel };

export interface PacingInput {
  startedAt: Date;
  /** Course deadline. Missing this forfeits the base stake. */
  normalDeadline: Date;
  /** Optional self-imposed deadline. Missing it only forfeits the bonus. */
  acceleratedDeadline?: Date | null;
  /** normalDeadline + grace period. */
  graceDeadline: Date;
  /** Verified progress across required module content, 0-100. */
  actualProgressPercent: number;
  now?: Date;
  /** Percentage-point gap that flips the attempt to AT_RISK. */
  atRiskThresholdPercent?: number;
}

export interface PacingResult {
  expectedProgressPercent: number;
  actualProgressPercent: number;
  /** Positive when the learner is behind expected progress. */
  gap: number;
  isAtRisk: boolean;
  riskLevel: RiskLevel;
  riskLabel: string;
  daysRemaining: number;
  hoursRemaining: number;
  /** Hours until the binding deadline (normal + grace) expires. */
  hoursUntilForfeiture: number;
  acceleratedDaysRemaining: number | null;
  acceleratedDeadlineMissed: boolean;
  inGracePeriod: boolean;
  deadlineMissed: boolean;
}

const RISK_LABELS: Record<RiskLevel, string> = {
  ON_TRACK: 'On Track',
  STEADY: 'Steady',
  AT_RISK: 'At Risk',
  GRACE_PERIOD: 'Grace Period',
  FAILED: 'Failed',
  COMPLETED: 'Completed',
};

export function computePacing(input: PacingInput): PacingResult {
  const now = input.now ?? new Date();
  const threshold = input.atRiskThresholdPercent ?? AT_RISK_THRESHOLD_PERCENT_FALLBACK;

  const expectedProgressPercent = roundTo(clamp(elapsedFraction(input.startedAt, input.normalDeadline, now), 0, 1) * 100, 1);
  const actualProgressPercent = roundTo(clamp(input.actualProgressPercent, 0, 100), 1);
  const gap = roundTo(expectedProgressPercent - actualProgressPercent, 1);

  const deadlineMissed = now.getTime() > input.normalDeadline.getTime();
  const inGracePeriod = deadlineMissed && now.getTime() <= input.graceDeadline.getTime();
  const hoursRemaining = Math.max(0, (input.normalDeadline.getTime() - now.getTime()) / MS_PER_HOUR);
  const hoursUntilForfeiture = Math.max(0, (input.graceDeadline.getTime() - now.getTime()) / MS_PER_HOUR);
  const acceleratedDeadlineMissed = Boolean(
    input.acceleratedDeadline && now.getTime() > input.acceleratedDeadline.getTime(),
  );

  let riskLevel: RiskLevel;
  if (inGracePeriod) {
    riskLevel = 'GRACE_PERIOD';
  } else if (deadlineMissed) {
    riskLevel = 'FAILED';
  } else if (gap >= threshold) {
    riskLevel = 'AT_RISK';
  } else if (gap > 0) {
    riskLevel = 'STEADY';
  } else {
    riskLevel = 'ON_TRACK';
  }

  return {
    expectedProgressPercent,
    actualProgressPercent,
    gap,
    isAtRisk: riskLevel === 'AT_RISK' || riskLevel === 'GRACE_PERIOD',
    riskLevel,
    riskLabel: RISK_LABELS[riskLevel],
    daysRemaining: daysRemaining(input.normalDeadline, now),
    hoursRemaining: roundTo(hoursRemaining, 1),
    hoursUntilForfeiture: roundTo(hoursUntilForfeiture, 1),
    acceleratedDaysRemaining: input.acceleratedDeadline ? daysRemaining(input.acceleratedDeadline, now) : null,
    acceleratedDeadlineMissed,
    inGracePeriod,
    deadlineMissed,
  };
}
