/**
 * Central business configuration.
 *
 * Every tunable threshold lives here so the rules of the platform can be
 * audited in one place (`BUSINESS_RULES.md` mirrors this file). A future
 * ML-driven recommendation engine can be swapped behind
 * `RecommendationService` without touching these constants.
 */

export const POINTS_CURRENCY = 'PTS' as const;

/** Default valid-watch percentage required to complete a video. */
export const DEFAULT_REQUIRED_WATCH_PERCENT = 90;

/** Watch segments shorter than this (seconds) are ignored as noise. */
export const MIN_TRACKED_SEGMENT_SECONDS = 2;

/**
 * A `progress` heartbeat may not claim more than this much forward progress
 * per real second of wall-clock time (2x playback tolerance).
 */
export const MAX_PLAYBACK_RATE = 2.5;

/** Learner must reach this fraction of a reading before "reached end" counts. */
export const READING_COMPLETION_THRESHOLD = 0.95;

/* -------------------------------------------------------------------------- */
/* Structured reading lessons (MOOC reader)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reading-lesson limits. They exist so a single lesson cannot become an
 * unbounded request/response payload or a denial-of-service vector, and they
 * document the authoring envelope the UI is built against.
 */
export const READING_LIMITS = {
  /** Sections per lesson. */
  maxSections: 60,
  /** Checkpoint questions per section. */
  maxQuestionsPerCheckpoint: 10,
  /** Options per checkpoint question. */
  maxOptionsPerQuestion: 8,
  /** Attached resources (PDFs + links) per lesson. */
  maxResources: 20,
  /** Rich-text body length per section (characters of HTML). */
  maxSectionChars: 60_000,
  /** Reading speed used for estimates when the instructor gives none. */
  wordsPerMinute: 200,
} as const;

/**
 * Bounds for optional AI helpers.
 *
 * `maxSourceChars` caps what is sent to a provider per request — long sections
 * are truncated with an explicit note rather than silently costing more.
 */
export const AI_LIMITS = {
  minSourceChars: 200,
  maxSourceChars: 14_000,
  maxQuestions: 5,
  minQuestions: 1,
} as const;

/* -------------------------------------------------------------------------- */
/* Instructor reputation                                                       */
/* -------------------------------------------------------------------------- */

export interface ReputationTierConfig {
  tier: 'BRONZE' | 'SILVER' | 'GOLD';
  /** Minimum number of settled learner outcomes required before the tier is eligible. */
  minLearnerOutcomes: number;
  minCompletionRate: number;
  minAverageScore: number;
  minCommitmentSuccessRate: number;
  minAverageRating: number;
  /** Weighted score floor (0-100) computed from the metrics below. */
  minCompositeScore: number;
}

export const REPUTATION_WEIGHTS = {
  completionRate: 0.35,
  averageScore: 0.3,
  commitmentSuccessRate: 0.2,
  averageRating: 0.15,
} as const;

/**
 * Badges are never awarded from a tiny sample size: `minLearnerOutcomes`
 * gates every tier. Tiers are ordered from highest to lowest requirement.
 */
export const REPUTATION_TIERS: ReputationTierConfig[] = [
  {
    tier: 'GOLD',
    minLearnerOutcomes: 40,
    minCompletionRate: 0.8,
    minAverageScore: 85,
    minCommitmentSuccessRate: 0.7,
    minAverageRating: 4.5,
    minCompositeScore: 85,
  },
  {
    tier: 'SILVER',
    minLearnerOutcomes: 20,
    minCompletionRate: 0.65,
    minAverageScore: 75,
    minCommitmentSuccessRate: 0.55,
    minAverageRating: 4.0,
    minCompositeScore: 72,
  },
  {
    tier: 'BRONZE',
    minLearnerOutcomes: 8,
    minCompletionRate: 0.5,
    minAverageScore: 65,
    minCommitmentSuccessRate: 0.4,
    minAverageRating: 3.5,
    minCompositeScore: 58,
  },
];

/** Instructor reputation modulates catalogue ordering — never stake pricing. */
export const REPUTATION_MARKET_WEIGHTS = {
  featuredEligibilityComposite: 75,
  searchBoostMultiplier: 0.25,
} as const;

/* -------------------------------------------------------------------------- */
/* Pacing / at-risk                                                            */
/* -------------------------------------------------------------------------- */

export const PACING = {
  /** Actual progress must trail expected progress by this many points to be AT_RISK. */
  atRiskProgressGap: 15,
  /** Minutes before an attempt deadline that a reminder notification is emitted. */
  deadlineReminderHours: [72, 24, 6, 1],
  /** Hours before a grace deadline that a final warning is emitted. */
  graceWarningHours: 12,
} as const;

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

/* -------------------------------------------------------------------------- */
/* Adaptive stake recommendation (rule-based v1)                               */
/* -------------------------------------------------------------------------- */

/**
 * Rule-based recommendation thresholds. The recommendation engine only ever
 * *suggests* a stake/deadline — it never mutates an enrolment.
 */
export const RECOMMENDATION_RULES = {
  /** Attempts needed before the engine trusts the learner's history. */
  minAttemptsForConfidence: 3,
  /** Completion rate at or above this -> recommend a more ambitious commitment. */
  highPerformerCompletionRate: 0.8,
  highPerformerAverageScore: 82,
  /** Completion rate at or below this -> recommend a softer commitment. */
  strugglingCompletionRate: 0.4,
  /** Deadline stretch factor applied for struggling learners. */
  strugglingDeadlineMultiplier: 1.5,
  /** Extra days added for learners with no history on the platform. */
  newLearnerBufferDays: 7,
} as const;

export const JOB_NAMES = {
  deadlineSettlement: 'deadline-settlement',
  atRiskScan: 'at-risk-scan',
  deadlineReminders: 'deadline-reminders',
  reputationRecompute: 'reputation-recompute',
} as const;
