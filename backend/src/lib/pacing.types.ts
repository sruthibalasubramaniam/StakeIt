/** Kept in its own module so `pacing.ts` and `constants.ts` never import each other. */
export type RiskLevel = 'ON_TRACK' | 'STEADY' | 'AT_RISK' | 'GRACE_PERIOD' | 'FAILED' | 'COMPLETED';

/**
 * Default percentage-point gap between expected and actual progress that
 * flips an attempt to AT_RISK. The runtime value comes from
 * `AT_RISK_THRESHOLD_PERCENT` in the environment / `constants.ts`.
 */
export const AT_RISK_THRESHOLD_PERCENT_FALLBACK = 15;
