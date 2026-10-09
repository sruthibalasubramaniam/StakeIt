/**
 * API contract types.
 *
 * These mirror the DTOs produced by the Express services so components get
 * autocompletion and the compiler catches contract drift.
 */

export type Role = 'LEARNER' | 'INSTRUCTOR' | 'ADMIN';
export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type Difficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
export type ContentType = 'VIDEO' | 'READING' | 'QUIZ' | 'MODULE_ASSESSMENT' | 'CODING' | 'SUBJECTIVE';
export type ContentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type AttemptStatus = 'ACTIVE' | 'AT_RISK' | 'GRACE_PERIOD' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
export type RiskLevel = 'ON_TRACK' | 'STEADY' | 'AT_RISK' | 'GRACE_PERIOD' | 'FAILED' | 'COMPLETED';
export type StakeType = 'BASE' | 'COMMITMENT';
export type StakeStatus = 'LOCKED' | 'RETURNED' | 'FORFEITED';
export type BadgeTier = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';
export type NotificationType =
  | 'ENROLLMENT'
  | 'DEADLINE_APPROACHING'
  | 'AT_RISK'
  | 'ACCELERATED_DEADLINE'
  | 'COURSE_COMPLETED'
  | 'REWARD_RECEIVED'
  | 'STAKE_FORFEITED'
  | 'RETRY_AVAILABLE'
  | 'INSTRUCTOR_BADGE'
  | 'SYSTEM';

export interface WalletSummary {
  availableBalance: number;
  lockedBalance: number;
  totalBalance: number;
  lifetimeEarned: number;
  lifetimeStaked: number;
  lifetimeForfeited: number;
}

export interface WalletSnapshot extends WalletSummary {
  walletId: string;
  version: number;
}

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  expertise: string[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthenticatedUser extends PublicUser {
  wallet: WalletSummary;
}

export interface AuthResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken?: string;
  expiresIn: string;
}

export interface InstructorCard {
  id: string;
  fullName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  expertise: string[];
  badge: BadgeTier;
  courseCount?: number;
}

export interface CommitmentOption {
  id: string;
  label: string;
  durationDays: number;
  commitmentStake: number;
  commitmentBonus: number;
  isDefault: boolean;
}

export interface CourseSummary {
  id: string;
  code: string;
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  difficulty: Difficulty;
  coverImageUrl: string | null;
  tags: string[];
  status: CourseStatus;
  durationDays: number;
  gracePeriodHours: number;
  baseStake: number;
  completionReward: number;
  commitmentBonus: number;
  performanceBonus: number;
  performanceThreshold: number;
  maxAttempts: number;
  totalPotentialReturn: number;
  instructor: InstructorCard;
  moduleCount?: number;
  learnerCount?: number;
  ratingCount: number;
  averageRating: number | null;
  averageDifficulty: number | null;
  recommendationRate: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  commitmentOptions?: CommitmentOption[];
  enrollment?: { id: string; courseId: string; status: string; attemptCount: number } | null;
}

export interface CourseContentItem {
  id: string;
  type: ContentType;
  title: string;
  description: string | null;
  orderIndex: number;
  isRequired: boolean;
  estimatedMinutes: number | null;
  durationSeconds: number | null;
  requiredWatchPercent: number | null;
  quiz: { id: string; passingScore: number; questionCount?: number } | null;
  assessment: { id: string; title: string; passingScore: number; type: string } | null;
}

export interface CourseModule {
  id: string;
  title: string;
  summary: string | null;
  orderIndex: number;
  isRequired: boolean;
  contents: CourseContentItem[];
}

export interface CourseDetail extends CourseSummary {
  description: string;
  moduleWeight: number;
  finalTestWeight: number;
  minFinalTestScore: number | null;
  moduleQuizWeight: number;
  moduleAssessmentWeight: number;
  requiredWatchPercent: number;
  modules: CourseModule[];
  finalAssessment: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    passingScore: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    _count?: { questions: number };
  } | null;
}

export interface Pacing {
  expectedProgressPercent: number;
  actualProgressPercent: number;
  gap: number;
  isAtRisk: boolean;
  riskLevel: RiskLevel;
  riskLabel: string;
  daysRemaining: number;
  hoursRemaining: number;
  hoursUntilForfeiture: number;
  acceleratedDaysRemaining: number | null;
  acceleratedDeadlineMissed: boolean;
  inGracePeriod: boolean;
  deadlineMissed: boolean;
}

export interface ContentView {
  id: string;
  type: ContentType;
  title: string;
  description: string | null;
  orderIndex: number;
  isRequired: boolean;
  estimatedMinutes: number | null;
  durationSeconds: number | null;
  requiredWatchPercent: number | null;
  isUnlocked: boolean;
  isCompleted: boolean;
  lockReason: string | null;
  isCurrent: boolean;
  progress: {
    status: ContentStatus;
    watchedSeconds: number;
    validWatchPercent: number;
    lastPositionSeconds: number;
    readingReachedEnd: boolean;
    comprehensionPassed: boolean | null;
    usesComprehensionCheck: boolean;
    activeSeconds: number;
    completedAt: string | null;
  };
  quiz: {
    id: string;
    passingScore: number;
    passed: boolean;
    bestPercentage: number | null;
    attemptsUsed: number;
    maxAttempts: number | null;
  } | null;
  assessment: {
    id: string;
    title: string;
    passingScore: number;
    type: string;
    passed: boolean;
    bestPercentage: number | null;
    attemptsUsed: number;
    maxAttempts: number | null;
  } | null;
}

export interface ModuleView {
  id: string;
  title: string;
  summary: string | null;
  orderIndex: number;
  isRequired: boolean;
  isUnlocked: boolean;
  isCompleted: boolean;
  progressPercent: number;
  completedCount: number;
  requiredCount: number;
  contents: ContentView[];
}

export interface LearningState {
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string;
    normalDeadline: string;
    acceleratedDeadline: string | null;
    graceDeadline: string;
    completedAt: string | null;
    moduleScore: number | null;
    finalTestScore: number | null;
    finalScore: number | null;
    commitmentMet: boolean | null;
    performanceBonusAwarded: boolean;
    pointsAwarded: number;
    pointsForfeited: number;
    settledAt: string | null;
  };
  course: {
    id: string;
    code: string;
    slug: string;
    title: string;
    shortDescription: string;
    category: string;
    difficulty: Difficulty;
    instructorId: string;
    durationDays: number;
    gracePeriodHours: number;
    moduleWeight: number;
    finalTestWeight: number;
    minFinalTestScore: number | null;
    performanceThreshold: number;
    requiredWatchPercent: number;
    maxAttempts: number;
    baseStake: number;
    completionReward: number;
    commitmentBonus: number;
    performanceBonus: number;
  };
  enrollmentId: string;
  modules: ModuleView[];
  finalAssessment: {
    id: string;
    title: string;
    description: string | null;
    passingScore: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    isUnlocked: boolean;
    isCompleted: boolean;
    lockReason: string | null;
    attemptsUsed: number;
    bestPercentage: number | null;
    passed: boolean;
  } | null;
  nextContent: { kind: 'CONTENT' | 'FINAL_ASSESSMENT'; id: string; title: string; type?: ContentType } | null;
  progress: {
    totalRequired: number;
    completedRequired: number;
    overallProgressPercent: number;
    moduleCount: number;
    completedModules: number;
    allModulesCompleted: boolean;
  };
  deadline: Pacing & { potentialReward: number };
  stake: {
    baseStake: number;
    commitmentStake: number;
    totalStaked: number;
    baseStakeAmount: number;
    completionReward: number;
    commitmentBonus: number;
    performanceBonus: number;
    performanceThreshold: number;
  };
  rules: {
    requiredWatchPercent: number;
    minFinalTestScore: number | null;
    performanceThreshold: number;
    moduleWeight: number;
    finalTestWeight: number;
    maxAttempts: number;
  };
  entry: LearningEntry;
}

export interface LearningEntry {
  enrollment: {
    id: string;
    status: string;
    attemptCount: number;
    enrolledAt: string;
    completedAt: string | null;
    bestScore: number | null;
  };
  course: CourseSummary;
  attemptId: string;
  attemptNumber: number;
  attemptStatus: AttemptStatus;
  isSettled: boolean;
  canRetry: boolean;
  attemptsRemaining: number;
  redirectToCompletion: boolean;
}

export interface ContentPayload {
  content: ContentView;
  module: { id: string; title: string; orderIndex: number; position: number; total: number };
  course: { id: string; title: string; code: string };
  attempt: { id: string; attemptNumber: number; status: AttemptStatus };
  navigation: {
    nextContentId: string | null;
    previousContentId: string | null;
    nextModuleUnlockHint: string;
  };
  progress: LearningState['progress'];
  nextContent: LearningState['nextContent'];
  payload:
    | { kind: 'VIDEO'; videoUrl: string | null; durationSeconds: number; requiredWatchPercent: number }
    | {
        kind: 'READING';
        body: string | null;
        requiresComprehensionCheck: boolean;
        comprehensionPrompt: string | null;
        completionThreshold: number;
      }
    | { kind: 'QUIZ'; quizId: string; passingScore: number }
    | { kind: 'MODULE_ASSESSMENT'; assessmentId: string; passingScore: number }
    | { kind: 'UNSUPPORTED' };
}

export interface QuizQuestion {
  id: string;
  type: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TRUE_FALSE' | 'SHORT_TEXT' | 'CODING' | 'SUBJECTIVE';
  prompt: string;
  points: number;
  orderIndex: number;
  options: Array<{ id: string; label: string; detail: string | null; orderIndex: number }>;
}

export interface QuizPayload {
  quiz: {
    id: string;
    title: string;
    description: string | null;
    passingScore: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    totalPoints: number;
  };
  module: { id: string; title: string };
  questions: QuizQuestion[];
  attemptInfo: {
    attemptsUsed: number;
    attemptsRemaining: number | null;
    bestPercentage: number | null;
    passed: boolean;
    lastAttempt: { attemptNumber: number; percentage: number; passed: boolean; submittedAt: string | null } | null;
  };
  navigation: { courseContentId: string };
}

export interface AssessmentPayload {
  assessment: {
    id: string;
    type: 'MODULE' | 'FINAL';
    title: string;
    description: string | null;
    passingScore: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    totalPoints: number;
    minFinalTestScore: number | null;
  };
  module: { id: string; title: string } | null;
  course: {
    id: string;
    title: string;
    code: string;
    moduleWeight: number;
    finalTestWeight: number;
    performanceThreshold: number;
    performanceBonus: number;
  };
  questions: QuizQuestion[];
  attemptInfo: {
    attemptsUsed: number;
    attemptsRemaining: number | null;
    bestPercentage: number | null;
    passed: boolean;
    lastAttempt: { attemptNumber: number; percentage: number; passed: boolean; status: string; submittedAt: string } | null;
  };
  isFinal: boolean;
}

export interface GradedQuestionReview {
  questionId: string;
  prompt: string;
  type: string;
  correct: boolean;
  pendingReview: boolean;
  awarded: number;
  maxPoints: number;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  explanation: string | null;
  options: Array<{ id: string; label: string; detail: string | null; isCorrect: boolean; selected: boolean }>;
}

export interface SubmissionResult {
  submission: {
    id: string;
    attemptNumber: number;
    score: number;
    maxScore: number;
    percentage: number;
    passed: boolean;
    status: string;
    submittedAt: string;
  };
  passingScore: number;
  minFinalTestScore: number | null;
  correctCount: number;
  totalQuestions: number;
  hasPendingReview: boolean;
  isFinal: boolean;
  attemptsRemaining: number | null;
  mayRetry: boolean;
  missedMinimum: boolean;
  review: GradedQuestionReview[];
  progress: LearningState['progress'];
  settlement: SettlementSummary | null;
}

export interface SettlementLine {
  label: string;
  amount: number;
  transactionType: string;
}

export interface SettlementSummary {
  attemptId: string;
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  courseCode: string;
  attemptNumber: number;
  status: string;
  isRetry: boolean;
  auditReference: string;
  completedAt: string;
  breakdown: {
    moduleScore: number;
    finalTestScore: number;
    finalScore: number;
    moduleWeight: number;
    finalTestWeight: number;
  };
  thresholds: {
    passingScore: number | null;
    minFinalTestScore: number | null;
    performanceThreshold: number;
    cohortThreshold: number;
    cohortThresholdSatisfied: boolean;
  };
  lines: SettlementLine[];
  stakeReturned: number;
  rewardsAwarded: number;
  totalCredited: number;
  pointsForfeited: number;
  commitmentMet: boolean | null;
  commitmentBonusAwarded: number;
  performanceBonusEarned: boolean;
  performanceBonusPoints: number;
  recoveryReward: number;
  wallet: { availableBalance: number; lockedBalance: number; totalBalance: number };
  ledgerTransactionIds: string[];
  hash: string;
  settledNow: boolean;
}

export interface EnrollmentRow {
  id: string;
  courseId: string;
  status: string;
  attemptCount: number;
  enrolledAt: string;
  completedAt: string | null;
  bestScore: number | null;
  course: CourseSummary;
  review: { rating: number; reviewText: string | null; createdAt: string } | null;
  activeAttempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string;
    normalDeadline: string;
    acceleratedDeadline: string | null;
    graceDeadline: string;
    completedAt: string | null;
    finalScore: number | null;
    moduleScore: number | null;
    finalTestScore: number | null;
    pointsAwarded: number;
    pointsForfeited: number;
    commitmentMet: boolean | null;
    progressPercent: number;
  } | null;
  pacing: Pacing | null;
  stake: {
    locked: number;
    baseStake: number;
    completionReward: number;
    commitmentBonus: number;
    performanceBonus: number;
    potentialReward: number;
  };
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string;
    normalDeadline: string;
    completedAt: string | null;
    failedAt: string | null;
    finalScore: number | null;
    pointsAwarded: number;
    pointsForfeited: number;
  }>;
}

export interface EnrollmentResult {
  enrollment: { id: string; courseId: string; status: string; attemptCount: number; enrolledAt: string };
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string;
    normalDeadline: string;
    acceleratedDeadline: string | null;
    graceDeadline: string;
  };
  isRetry: boolean;
  stakes: Array<{ id: string; type: StakeType; amount: number; status: StakeStatus; lockedAt: string }>;
  commitment: CommitmentOption | null;
  wallet: WalletSummary;
  potentialReturn: {
    stake: number;
    completionReward: number;
    commitmentBonus: number;
    performanceBonus: number;
    total: number;
  };
}

export interface StakeRow {
  id: string;
  type: StakeType;
  amount: number;
  status: StakeStatus;
  lockedAt: string;
  settledAt: string | null;
  settlementReason: string | null;
  returnedAmount: number;
  course: { id: string; title: string; code: string; slug: string; baseStake: number; completionReward: number; commitmentBonus: number; performanceBonus: number };
  commitment: { label: string; durationDays: number | null; commitmentBonus: number | null } | null;
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    normalDeadline: string;
    acceleratedDeadline: string | null;
    graceDeadline: string;
    finalScore: number | null;
    completedAt: string | null;
    failedAt: string | null;
  };
}

export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  description: string;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean };
}

export interface LearnerDashboard {
  wallet: WalletSnapshot;
  summary: {
    activeCourses: number;
    completedCourses: number;
    atRiskCourses: number;
    totalStaked: number;
    totalStakedCount: number;
    bestScore: number;
    averageCompletedScore: number;
  };
  activeCourses: Array<{
    enrollmentId: string;
    attemptId: string;
    attemptNumber: number;
    status: AttemptStatus;
    course: {
      id: string;
      code: string;
      slug: string;
      title: string;
      category: string;
      difficulty: Difficulty;
      durationDays: number;
      baseStake: number;
      completionReward: number;
      commitmentBonus: number;
      performanceBonus: number;
      coverImageUrl: string | null;
      instructor: { id: string; fullName: string };
    };
    progressPercent: number;
    pacing: Pacing;
    lockedStake: number;
    normalDeadline: string;
    acceleratedDeadline: string | null;
    graceDeadline: string;
    commitmentStake: number;
    potentialReward: number;
  }>;
  atRisk: Array<{
    enrollmentId: string;
    attemptId: string;
    title: string;
    code: string;
    progressPercent: number;
    expectedProgressPercent: number;
    gap: number;
    daysRemaining: number;
    lockedStake: number;
  }>;
  upcomingDeadlines: Array<{
    enrollmentId: string;
    attemptId: string;
    courseId: string;
    title: string;
    code: string;
    normalDeadline: number;
    acceleratedDaysRemaining: number | null;
    riskLevel: RiskLevel;
    riskLabel: string;
    hoursUntilForfeiture: number;
    progressPercent: number;
    lockedStake: number;
  }>;
  completedCourses: Array<{
    enrollmentId: string;
    attemptId: string | null;
    completedAt: string | null;
    finalScore: number | null;
    pointsAwarded: number;
    course: { id: string; code: string; slug: string; title: string; category: string; difficulty: Difficulty };
    hasReview: boolean;
  }>;
  recentRewards: WalletTransaction[];
  recentTransactions: WalletTransaction[];
  achievements: {
    certificates: number;
    bestScore: number;
    perfectScores: number;
    performanceBonusesEarned: number;
    commitmentBonusesEarned: number;
  };
  notifications: NotificationRow[];
}

export interface InstructorCourseMetrics {
  id: string;
  code: string;
  slug: string;
  title: string;
  status: CourseStatus;
  category: string;
  difficulty: Difficulty;
  baseStake: number;
  moduleCount: number;
  learnerCount: number;
  completions: number;
  averageScore: number;
  averageModuleScore: number;
  averageFinalTestScore: number;
  averageRating: number;
  ratingCount: number;
  publishedAt: string | null;
  updatedAt: string;
}

export interface InstructorDashboard {
  courses: InstructorCourseMetrics[];
  overview: {
    totalCourses: number;
    publishedCourses: number;
    draftCourses: number;
    totalLearners: number;
    activeAttempts: number;
    atRiskAttempts: number;
    completions: number;
    failures: number;
    completionRate: number;
    averageScore: number;
    averageRating: number;
    ratingCount: number;
    successfulCommitments: number;
    commitmentSuccessRate: number;
  };
  reputation: {
    tier: BadgeTier;
    eligibleTier: BadgeTier;
    compositeScore: number;
    tierProgress: Array<{ tier: BadgeTier; eligible: boolean; missing: string[] }>;
    featuredEligible: boolean;
    metrics: {
      learnerOutcomes: number;
      distinctLearners: number;
      completionRate: number;
      averageScore: number;
      commitmentSuccessRate: number;
      averageRating: number;
      ratingCount: number;
      compositeScore: number;
      tierProgress: Array<{ tier: BadgeTier; eligible: boolean; missing: string[] }>;
    };
  };
  recentActivity: Array<{
    id: string;
    status: AttemptStatus;
    attemptNumber: number;
    updatedAt: string;
    finalScore: number | null;
    user: { id: string; fullName: string; email: string };
    course: { id: string; title: string; code: string };
  }>;
}

export interface CourseAnalytics {
  course: {
    id: string;
    code: string;
    title: string;
    baseStake: number;
    completionReward: number;
    moduleWeight: number;
    finalTestWeight: number;
    maxAttempts: number;
    performanceThreshold: number;
  };
  overview: {
    enrolled: number;
    active: number;
    completed: number;
    failed: number;
    withdrawn: number;
    completionRate: number;
    averageScore: number;
    averageModuleScore: number;
    averageFinalTestScore: number;
    atRisk: number;
    commitmentAttempts: number;
    commitmentSuccesses: number;
    commitmentSuccessRate: number;
    pointsAwarded: number;
    pointsForfeited: number;
    retries: number;
  };
  ratings: {
    average: number;
    count: number;
    recommendationRate: number;
    averageDifficulty: number;
    distribution: Array<{ rating: number; count: number }>;
  };
  moduleFunnel: Array<{ id: string; title: string; orderIndex: number; completedLearners: number; completionRate: number }>;
  learners: Array<{
    attemptId: string;
    attemptNumber: number;
    status: AttemptStatus;
    learner: { id: string; fullName: string; email: string };
    moduleScore: number | null;
    finalTestScore: number | null;
    finalScore: number | null;
    commitmentMet: boolean | null;
    pointsAwarded: number;
    pointsForfeited: number;
    startedAt: string;
    completedAt: string | null;
    failedAt: string | null;
    stakes: Array<{ type: StakeType; status: StakeStatus; amount: number }>;
  }>;
}

export interface AdminDashboard {
  users: { total: number; learners: number; instructors: number; admins: number };
  courses: { total: number; published: number; draft: number; archived: number };
  economy: {
    wallet: { totalAvailable: number; totalLocked: number; totalAccounts: number; averageBalance: number };
    rewardPool: { balance: number; totalIn: number; totalOut: number; updatedAt: string };
    pointsAwarded: number;
    pointsForfeited: number;
  };
  enrollments: Record<string, number>;
  attempts: Record<string, { count: number; awarded: number; forfeited: number }>;
  moderation: { flaggedReviews: number };
  badges: { gold: number; silver: number; bronze: number; total: number };
  recentTransactions: Array<WalletTransaction & { user: { id: string; fullName: string; email: string; role: Role } }>;
  recentPoolTransactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>;
}

export interface RewardPoolSummary {
  balance: number;
  totalIn: number;
  totalOut: number;
  updatedAt: string;
}

export interface PoolTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
}

export interface Recommendation {
  recommendedStake: number;
  recommendedDurationDays: number;
  recommendedCommitmentOptionId: string | null;
  recommendedCommitmentLabel: string | null;
  recommendAccelerated: boolean;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  stance: 'AMBITIOUS' | 'BALANCED' | 'CAUTIOUS' | 'NEUTRAL';
  rationale: string[];
  learnerStatistics: {
    totalAttempts: number;
    completions: number;
    failures: number;
    completionRate: number;
    averageScore: number;
    commitmentAttempts: number;
    commitmentSuccessRate: number;
    onTimeRate: number;
  };
}

export interface ModuleAuthoring {
  id: string;
  title: string;
  summary: string | null;
  orderIndex: number;
  isRequired: boolean;
  contents: Array<{
    id: string;
    type: ContentType;
    title: string;
    description: string | null;
    orderIndex: number;
    isRequired: boolean;
    estimatedMinutes: number | null;
    durationSeconds: number | null;
    requiredWatchPercent: number | null;
    videoUrl?: string | null;
    readingBody?: string | null;
    requiresComprehensionCheck?: boolean;
    comprehensionPrompt?: string | null;
    quiz: { id: string; passingScore: number; maxAttempts: number | null; _count: { questions: number } } | null;
    assessment: {
      id: string;
      title: string;
      passingScore: number;
      maxAttempts: number | null;
      type: string;
      _count: { questions: number };
    } | null;
  }>;
}

export interface InstructorProfilePublic {
  instructor: {
    id: string;
    fullName: string;
    headline: string | null;
    bio: string | null;
    avatarUrl: string | null;
    expertise: string[];
    createdAt: string;
  };
  reputation: {
    tier: BadgeTier;
    awardedAt: string | null;
    completionRate: number;
    averageScore: number;
    averageRating: number;
    learnerOutcomes: number;
    compositeScore: number;
  };
  badges: Array<{ id: string; tier: BadgeTier; awardedAt: string; isActive: boolean; notes: string | null }>;
  courses: CourseSummary[];
}
