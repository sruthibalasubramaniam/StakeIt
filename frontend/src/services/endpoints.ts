/**
 * Typed API surface.
 *
 * Every function here maps 1:1 to an Express route — no mock data, no silent
 * fallbacks. Components import these instead of calling axios directly, which
 * keeps URL knowledge in one place.
 */
import { http } from './api';
import type {
  AdminDashboard,
  AssessmentPayload,
  AiDraftedQuestions,
  CertificateVerification,
  CertificateView,
  ReadingCheckpointResult,
  ReadingImportResult,
  ReadingSectionSummary,
  ReadingLessonAuthoring,
  ReadingPreviewPayload,
  ReadingSectionMutationResult,
  AuthenticatedUser,
  AuthResult,
  CommitmentOption,
  ContentPayload,
  CourseAnalytics,
  CourseDetail,
  CourseSummary,
  EnrollmentResult,
  EnrollmentRow,
  InstructorDashboard,
  InstructorProfilePublic,
  LearnerDashboard,
  LearningEntry,
  LearningState,
  ModuleAuthoring,
  ModuleView,
  NotificationRow,
  Paginated,
  Pacing,
  PoolTransaction,
  PublicUser,
  QuizPayload,
  Recommendation,
  RewardPoolSummary,
  Role,
  SettlementSummary,
  StakeRow,
  SubmissionResult,
  WalletSnapshot,
  WalletSummary,
  WalletTransaction,
} from '../types/api';

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const authApi = {
  register: (body: {
    email: string;
    password: string;
    fullName: string;
    role?: 'LEARNER' | 'INSTRUCTOR';
    headline?: string;
    bio?: string;
    expertise?: string[];
  }) => http.post<AuthResult>('/auth/register', body),

  login: (body: { email: string; password: string }) => http.post<AuthResult>('/auth/login', body),

  logout: () => http.post<{ success: boolean }>('/auth/logout'),

  profile: () => http.get<AuthenticatedUser>('/auth/profile'),

  updateProfile: (body: {
    fullName?: string;
    headline?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
    expertise?: string[];
  }) => http.patch<AuthenticatedUser>('/auth/profile', body),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    http.post<{ success: boolean }>('/auth/change-password', body),
};

/* -------------------------------------------------------------------------- */
/* Courses                                                                     */
/* -------------------------------------------------------------------------- */

export interface CourseListQuery {
  q?: string;
  category?: string;
  difficulty?: string;
  status?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  instructorId?: string;
  includeUnpublished?: 'true' | 'false';
}

export const courseApi = {
  list: (query: CourseListQuery = {}) => http.get<Paginated<CourseSummary>>('/courses', { params: query }),

  facets: () => http.get<{ categories: Array<{ value: string; count: number }>; difficulties: Array<{ value: string; count: number }> }>('/courses/facets'),

  detail: (idOrSlug: string) => http.get<CourseDetail>(`/courses/${idOrSlug}`),

  create: (body: Record<string, unknown>) => http.post<CourseSummary>('/courses', body),

  update: (courseId: string, body: Record<string, unknown>) => http.put<CourseSummary>(`/courses/${courseId}`, body),

  remove: (courseId: string) => http.delete<{ id: string; deleted: boolean }>(`/courses/${courseId}`),

  publish: (courseId: string) => http.post<CourseSummary>(`/courses/${courseId}/publish`),

  unpublish: (courseId: string) => http.post<CourseSummary>(`/courses/${courseId}/unpublish`),

  archive: (courseId: string) => http.post<CourseSummary>(`/courses/${courseId}/archive`),

  preview: (courseId: string) => http.get<CourseDetail>(`/courses/${courseId}/preview`),

  recommendation: (courseId: string) => http.get<Recommendation>(`/courses/${courseId}/recommendation`),

  reviews: (courseId: string) =>
    http.get<{ reviews: Array<Record<string, unknown>>; average: number | null; count: number }>(`/courses/${courseId}/reviews`),

  createReview: (
    courseId: string,
    body: { rating: number; difficultyRating?: number | null; wouldRecommend?: boolean; reviewText?: string | null },
  ) => http.post<Record<string, unknown>>(`/courses/${courseId}/reviews`, body),

  analytics: (courseId: string) => http.get<CourseAnalytics>(`/courses/${courseId}/analytics`),
};

/* -------------------------------------------------------------------------- */
/* Curriculum authoring                                                        */
/* -------------------------------------------------------------------------- */

export const curriculumApi = {
  listModules: (courseId: string) => http.get<ModuleAuthoring[]>(`/courses/${courseId}/modules`),

  createModule: (courseId: string, body: { title: string; summary?: string; isRequired?: boolean }) =>
    http.post<ModuleAuthoring>(`/courses/${courseId}/modules`, body),

  updateModule: (moduleId: string, body: { title?: string; summary?: string | null; isRequired?: boolean }) =>
    http.put<ModuleAuthoring>(`/modules/${moduleId}`, body),

  deleteModule: (moduleId: string) => http.delete<{ id: string; deleted: boolean }>(`/modules/${moduleId}`),

  reorderModules: (courseId: string, orderedIds: string[]) =>
    http.patch<ModuleAuthoring[]>(`/courses/${courseId}/modules/reorder`, { orderedIds }),

  createContent: (moduleId: string, body: Record<string, unknown>) =>
    http.post<ModuleAuthoring['contents'][number]>(`/modules/${moduleId}/content`, body),

  updateContent: (contentId: string, body: Record<string, unknown>) =>
    http.put<ModuleAuthoring['contents'][number]>(`/content/${contentId}`, body),

  deleteContent: (contentId: string) => http.delete<{ id: string; deleted: boolean }>(`/content/${contentId}`),

  reorderContent: (moduleId: string, orderedIds: string[]) =>
    http.patch<ModuleAuthoring['contents']>(`/modules/${moduleId}/content/reorder`, { orderedIds }),

  updateQuizSettings: (
    quizId: string,
    body: { title?: string; description?: string | null; passingScore?: number; maxAttempts?: number | null; timeLimitMinutes?: number | null; shuffleQuestions?: boolean },
  ) => http.patch<Record<string, unknown>>(`/quizzes/${quizId}/settings`, body),

  replaceQuizQuestions: (
    quizId: string,
    questions: Array<{
      type?: string;
      prompt: string;
      explanation?: string | null;
      points?: number;
      options?: Array<{ label: string; detail?: string | null; isCorrect?: boolean }>;
    }>,
  ) => http.put<Record<string, unknown>>(`/quizzes/${quizId}/questions`, { questions }),

  replaceAssessmentQuestions: (
    assessmentId: string,
    questions: Array<{
      type?: string;
      prompt: string;
      explanation?: string | null;
      points?: number;
      options?: Array<{ label: string; detail?: string | null; isCorrect?: boolean }>;
    }>,
  ) => http.put<Record<string, unknown>>(`/assessments/${assessmentId}/questions`, { questions }),

  upsertFinalAssessment: (
    courseId: string,
    body: { title?: string; description?: string; passingScore?: number; maxAttempts?: number | null; timeLimitMinutes?: number | null },
  ) => http.post<Record<string, unknown>>(`/courses/${courseId}/final-assessment`, body),

  replaceCommitmentOptions: (
    courseId: string,
    options: Array<{ label: string; durationDays: number; commitmentStake: number; commitmentBonus: number; isDefault?: boolean }>,
  ) => http.post<CommitmentOption[]>(`/courses/${courseId}/commitment-options`, { options }),
};

/* -------------------------------------------------------------------------- */
/* Structured reading lessons                                                  */
/* -------------------------------------------------------------------------- */

export const readingApi = {
  /** Full draft: sections, checkpoints with answer keys, resources. */
  view: (contentId: string) => http.get<ReadingLessonAuthoring>(`/content/${contentId}/reading`),

  updateLesson: (
    contentId: string,
    body: {
      description?: string | null;
      estimatedMinutes?: number | null;
      objectives?: string[];
      references?: Array<{ label: string; url: string; note?: string | null }>;
    },
  ) => http.put<Record<string, unknown>>(`/content/${contentId}/reading`, body),

  createSection: (contentId: string, body: { title: string; bodyHtml?: string; estimatedMinutes?: number | null }) =>
    http.post<Record<string, unknown>>(`/content/${contentId}/reading/sections`, body),

  updateSection: (
    contentId: string,
    sectionId: string,
    body: { title?: string; bodyHtml?: string; estimatedMinutes?: number | null },
  ) => http.put<Record<string, unknown>>(`/content/${contentId}/reading/sections/${sectionId}`, body),

  deleteSection: (contentId: string, sectionId: string) =>
    http.delete<{ id: string; deleted: boolean }>(`/content/${contentId}/reading/sections/${sectionId}`),

  reorderSections: (contentId: string, orderedIds: string[]) =>
    http.patch<Record<string, unknown>>(`/content/${contentId}/reading/sections/reorder`, { orderedIds }),

  saveCheckpoint: (
    contentId: string,
    sectionId: string,
    body: {
      title?: string;
      prompt?: string | null;
      passingScore?: number;
      maxAttempts?: number | null;
      questions: Array<{
        type?: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TRUE_FALSE';
        prompt: string;
        explanation?: string | null;
        points?: number;
        options: Array<{ label: string; isCorrect?: boolean }>;
      }>;
    },
  ) => http.put<Record<string, unknown>>(`/content/${contentId}/reading/sections/${sectionId}/checkpoint`, body),

  deleteCheckpoint: (contentId: string, sectionId: string) =>
    http.delete<{ id: string; deleted: boolean }>(`/content/${contentId}/reading/sections/${sectionId}/checkpoint`),

  publish: (contentId: string) =>
    http.post<{ published: boolean; publishedAt: string | null }>(`/content/${contentId}/reading/publish`),

  unpublish: (contentId: string) =>
    http.post<{ published: boolean }>(`/content/${contentId}/reading/unpublish`),

  preview: (contentId: string) => http.get<ReadingPreviewPayload>(`/content/${contentId}/reading/preview`),

  addResource: (
    contentId: string,
    body: { kind: 'EXTERNAL_LINK' | 'EMBED'; title: string; url: string; isDownloadable?: boolean },
  ) => http.post<Record<string, unknown>>(`/content/${contentId}/reading/resources`, body),

  /**
   * Raw PDF upload. The file is sent as the request body (not multipart), with
   * the display name in a header — the API caps the size and verifies the magic
   * bytes before storing it privately.
   */
  uploadPdf: (contentId: string, file: File, title?: string) =>
    http.post<Record<string, unknown>>(`/content/${contentId}/reading/resources/upload`, file, {
      headers: {
        'Content-Type': 'application/pdf',
        'x-file-name': encodeURIComponent(file.name),
        ...(title ? { 'x-resource-title': encodeURIComponent(title) } : {}),
      },
      timeout: 120_000,
    }),

  deleteResource: (contentId: string, resourceId: string) =>
    http.delete<{ id: string; deleted: boolean }>(`/content/${contentId}/reading/resources/${resourceId}`),

  /**
   * Import a document into draft sections. The file is sent as a raw body with
   * its name in a header (no multipart parser on the server).
   */
  importDocument: (contentId: string, file: File, withAiCheckpoints = true) =>
    http.upload<ReadingImportResult>(`/content/${contentId}/reading/import`, file, {
      'Content-Type': file.type || 'application/octet-stream',
      'x-file-name': file.name,
      'x-ai-checkpoints': String(withAiCheckpoints),
    }),

  /** Optional: draft checkpoint questions from a section with the AI provider. */
  draftQuestions: (contentId: string, sectionId: string, count = 2) =>
    http.post<AiDraftedQuestions>(
      `/content/${contentId}/reading/sections/${sectionId}/questions/draft`,
      { count },
    ),

  resourceUrl: (contentId: string, resourceId: string) =>
    http.get<{ id: string; url: string | null; available: boolean }>(
      `/content/${contentId}/reading/resources/${resourceId}/url`,
    ),
};

/* -------------------------------------------------------------------------- */
/* Certificates                                                                */
/* -------------------------------------------------------------------------- */

export const certificateApi = {
  mine: () => http.get<CertificateView[]>('/certificates/mine'),

  forAttempt: (attemptId: string) =>
    http.get<{ certificate: CertificateView | null }>(`/attempts/${attemptId}/certificate`),

  /** Issues (or returns) the certificate for a completed attempt. */
  issue: (attemptId: string) =>
    http.post<{ certificate: CertificateView }>(`/attempts/${attemptId}/certificate`),

  /** Downloads the PDF and hands back a blob for the browser to save. */
  download: (attemptId: string) => http.blob(`/attempts/${attemptId}/certificate/file`),

  verify: (code: string) =>
    http.get<CertificateVerification>(`/certificates/verify/${encodeURIComponent(code)}`),
};

/* -------------------------------------------------------------------------- */
/* Enrolment & learning                                                        */
/* -------------------------------------------------------------------------- */

export const enrollmentApi = {
  enroll: (courseId: string, body: { accelerated?: boolean; commitmentOptionId?: string | null } = {}) =>
    http.post<EnrollmentResult>(`/courses/${courseId}/enroll`, body),

  list: (query: { status?: string } = {}) => http.get<EnrollmentRow[]>('/enrollments', { params: query }),

  detail: (enrollmentId: string) => http.get<LearningEntry>(`/enrollments/${enrollmentId}`),

  learningState: (enrollmentId: string) => http.get<LearningState>(`/enrollments/${enrollmentId}/learning-state`),

  retry: (enrollmentId: string, body: { accelerated?: boolean; commitmentOptionId?: string | null } = {}) =>
    http.post<EnrollmentResult>(`/enrollments/${enrollmentId}/retry`, body),

  withdraw: (enrollmentId: string) => http.post<{ enrollmentId: string; returnedPoints: number }>(`/enrollments/${enrollmentId}/withdraw`),
};

export const learningApi = {
  content: (attemptId: string, contentId: string) => http.get<ContentPayload>(`/attempts/${attemptId}/content/${contentId}`),

  recordProgress: (
    attemptId: string,
    contentId: string,
    body: {
      positionSeconds?: number;
      fromSeconds?: number;
      elapsedRealSeconds?: number;
      durationSeconds?: number;
      playbackRate?: number;
      activeSeconds?: number;
      scrollPercent?: number;
      reachedEnd?: boolean;
    },
  ) =>
    http.post<{
      watchedSeconds?: number;
      validWatchPercent?: number;
      requiredWatchPercent?: number;
      isWatchRequirementMet?: boolean;
      suspicious?: boolean;
      notice?: string;
      readingReachedEnd?: boolean;
      requiresComprehensionCheck?: boolean;
      comprehensionPassed?: boolean | null;
      structured?: boolean;
    }>(`/attempts/${attemptId}/content/${contentId}/progress`, body),

  submitComprehension: (attemptId: string, contentId: string, answer: string) =>
    http.post<{ passed: boolean; comprehensionPassed: boolean | null; feedback: string }>(
      `/attempts/${attemptId}/content/${contentId}/comprehension`,
      { answer },
    ),

  /* ---------------------- Structured reading lesson ---------------------- */

  /** Persists the reader's position so "Continue reading" can resume. */
  saveReadingPosition: (
    attemptId: string,
    contentId: string,
    body: { sectionId?: string | null; pdfPage?: number | null; activeSeconds?: number },
  ) =>
    http.post<{
      lastSectionId: string | null;
      lastSectionIndex: number | null;
      lastPdfPage: number | null;
      sectionsCompleted: number;
      totalSections: number;
    }>(`/attempts/${attemptId}/content/${contentId}/reading/position`, body),

  /** Marks a checkpoint-free section as read (server re-checks the lock). */
  markReadingSection: (attemptId: string, contentId: string, sectionId: string, activeSeconds = 0) =>
    http.post<ReadingSectionMutationResult>(
      `/attempts/${attemptId}/content/${contentId}/reading/sections/${sectionId}/complete`,
      { activeSeconds },
    ),

  submitReadingCheckpoint: (
    attemptId: string,
    contentId: string,
    checkpointId: string,
    answers: Record<string, string[]>,
  ) =>
    http.post<ReadingCheckpointResult>(
      `/attempts/${attemptId}/content/${contentId}/reading/checkpoints/${checkpointId}/submit`,
      { answers },
    ),

  readingResourceUrl: (attemptId: string, contentId: string, resourceId: string) =>
    http.get<{ id: string; url: string | null; available: boolean }>(
      `/attempts/${attemptId}/content/${contentId}/reading/resources/${resourceId}/url`,
    ),

  /** Optional study aid for the section currently being read. */
  sectionSummary: (attemptId: string, contentId: string, sectionId: string) =>
    http.post<ReadingSectionSummary>(
      `/attempts/${attemptId}/content/${contentId}/reading/sections/${sectionId}/summary`,
      {},
    ),

  complete: (attemptId: string, contentId: string) =>
    http.post<{
      contentId: string;
      status: string;
      requirement: string;
      progress: LearningState['progress'];
      unlocked: { nextContent: LearningState['nextContent']; finalAssessmentUnlocked: boolean };
    }>(`/attempts/${attemptId}/content/${contentId}/complete`),

  module: (attemptId: string, moduleId: string) => http.get<ModuleView>(`/attempts/${attemptId}/modules/${moduleId}`),

  pacing: (attemptId: string) => http.get<Pacing>(`/attempts/${attemptId}/pacing`),

  settlement: (attemptId: string) => http.get<SettlementSummary>(`/attempts/${attemptId}/settlement`),

  settlementPreview: (attemptId: string) =>
    http.get<{
      moduleScore: number;
      finalTestScore: number;
      projectedFinalScore: number;
      projectedPerformanceBonus: number;
      lockedStake: number;
      potentialReward: number;
      modulesRemaining: number;
      finalAssessmentUnlocked: boolean;
    }>(`/attempts/${attemptId}/settlement/preview`),

  quiz: (attemptId: string, quizId: string) => http.get<QuizPayload>(`/attempts/${attemptId}/quizzes/${quizId}`),

  submitQuiz: (attemptId: string, quizId: string, answers: Record<string, string[]>, timeSpentSeconds?: number) =>
    http.post<{
      attempt: { attemptNumber: number; score: number; maxScore: number; percentage: number; passed: boolean; status: string; submittedAt: string };
      passingScore: number;
      correctCount: number;
      totalQuestions: number;
      hasPendingReview: boolean;
      review: SubmissionResult['review'];
      progress: LearningState['progress'];
      unlocked: { nextContent: LearningState['nextContent']; finalAssessmentUnlocked: boolean };
    }>(`/attempts/${attemptId}/quizzes/${quizId}/attempt`, { answers, timeSpentSeconds }),

  quizResults: (attemptId: string, quizId: string) => http.get<Record<string, unknown>>(`/attempts/${attemptId}/quizzes/${quizId}/results`),

  assessment: (attemptId: string, assessmentId: string) =>
    http.get<AssessmentPayload>(`/attempts/${attemptId}/assessments/${assessmentId}`),

  submitAssessment: (attemptId: string, assessmentId: string, answers: Record<string, string[]>, timeSpentSeconds?: number) =>
    http.post<SubmissionResult>(`/attempts/${attemptId}/assessments/${assessmentId}/submit`, { answers, timeSpentSeconds }),

  assessmentResults: (attemptId: string, assessmentId: string) =>
    http.get<Record<string, unknown>>(`/attempts/${attemptId}/assessments/${assessmentId}/results`),
};

/* -------------------------------------------------------------------------- */
/* Wallet, stakes, rewards                                                     */
/* -------------------------------------------------------------------------- */

export const walletApi = {
  get: () =>
    http.get<
      WalletSnapshot & {
        stakes: {
          activeStakePoints: number;
          forfeitedPoints: number;
          forfeitedCount: number;
          returnedPoints: number;
          returnedCount: number;
          activeCommitments: number;
        };
      }
    >('/wallet'),

  transactions: (query: { page?: number; pageSize?: number; type?: string } = {}) =>
    http.get<Paginated<WalletTransaction>>('/wallet/transactions', { params: query }),

  insights: () =>
    http.get<{
      totalAttempts: number;
      completions: number;
      failures: number;
      completionRate: number;
      averageScore: number;
      averageOnTimeRate?: number;
      onTimeRate: number;
      commitmentAttempts: number;
      commitmentSuccessRate: number;
      headline: string;
      suggestedStance: string;
    }>('/wallet/insights'),
};

export const stakeApi = {
  list: (query: { status?: string; courseId?: string; page?: number; pageSize?: number } = {}) =>
    http.get<
      Paginated<StakeRow> & {
        totals: {
          lockedPoints: number;
          lockedCount: number;
          returnedPoints: number;
          returnedCount: number;
          forfeitedPoints: number;
          forfeitedCount: number;
        };
      }
    >('/stakes', { params: query }),

  summary: () =>
    http.get<{
      activeStakePoints: number;
      forfeitedPoints: number;
      forfeitedCount: number;
      returnedPoints: number;
      returnedCount: number;
      activeCommitments: number;
    }>('/stakes/summary'),

  detail: (stakeId: string) => http.get<StakeRow>(`/stakes/${stakeId}`),
};

export const rewardApi = {
  list: () =>
    http.get<{
      wallet: WalletSnapshot;
      stakes: { activeStakePoints: number; forfeitedPoints: number; returnedPoints: number; activeCommitments: number };
      totals: {
        courseRewards: number;
        commitmentBonuses: number;
        performanceBonuses: number;
        retryRewards: number;
        welcomeGrant: number;
        lifetimeEarned: number;
      };
      history: WalletTransaction[];
      pagination: Paginated<WalletTransaction>['pagination'];
      insights: { headline: string; completionRate: number; averageScore: number; totalAttempts: number };
    }>('/rewards'),

  pool: () =>
    http.get<{ pool: RewardPoolSummary; transactions?: Paginated<PoolTransaction> }>('/rewards/pool'),
};

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export const analyticsApi = {
  learnerDashboard: () => http.get<LearnerDashboard>('/dashboard'),

  instructorDashboard: () => http.get<InstructorDashboard>('/instructor/dashboard'),

  instructorCourses: () => http.get<CourseSummary[]>('/instructor/courses'),

  adminDashboard: () => http.get<AdminDashboard>('/admin/dashboard'),

  platformTransactions: (query: { page?: number; pageSize?: number; type?: string; userId?: string } = {}) =>
    http.get<Paginated<WalletTransaction & { user: { id: string; fullName: string; email: string; role: Role } }>>(
      '/admin/transactions',
      { params: query },
    ),
};

/* -------------------------------------------------------------------------- */
/* Instructor / admin                                                          */
/* -------------------------------------------------------------------------- */

export const adminApi = {
  listUsers: (query: { role?: string; q?: string; isActive?: string; page?: number; pageSize?: number; sort?: string } = {}) =>
    http.get<
      Paginated<
        PublicUser & {
          wallet: WalletSummary;
          counts: { enrollments: number; courses: number; stakes: number };
          badge: string | null;
        }
      >
    >('/admin/users', { params: query }),

  getUser: (userId: string) => http.get<Record<string, unknown>>(`/admin/users/${userId}`),

  updateUser: (userId: string, body: { role?: Role; isActive?: boolean; fullName?: string; headline?: string | null }) =>
    http.patch<PublicUser>(`/admin/users/${userId}`, body),

  deleteUser: (userId: string) =>
    http.delete<{ deleted: boolean; deactivated: boolean; reason?: string }>(`/admin/users/${userId}`),

  grantPoints: (userId: string, body: { amount: number; reason: string }) =>
    http.post<{ wallet: WalletSummary }>(`/admin/users/${userId}/points`, body),

  listCourses: (query: { status?: string; q?: string; page?: number; pageSize?: number } = {}) =>
    http.get<
      Paginated<
        CourseSummary & {
          instructor: { id: string; fullName: string; email: string };
          _count: { enrollments: number; modules: number; attempts: number };
        }
      >
    >('/admin/courses', { params: query }),

  listInstructors: (query: { q?: string; page?: number; pageSize?: number } = {}) =>
    http.get<Paginated<PublicUser & { courseCount: number; badge: string; metrics: Record<string, number>; eligibleTier: string }>>(
      '/admin/instructors',
      { params: query },
    ),

  listReviews: (query: { flaggedOnly?: string; page?: number; pageSize?: number } = {}) =>
    http.get<
      Paginated<{
        id: string;
        rating: number;
        difficultyRating: number | null;
        wouldRecommend: boolean;
        reviewText: string | null;
        isFlagged: boolean;
        flagReason: string | null;
        isPublished: boolean;
        createdAt: string;
        user: { id: string; fullName: string; email: string };
        course: { id: string; title: string; code: string; instructorId: string };
      }>
    >('/admin/reviews', { params: query }),

  moderateReview: (reviewId: string, body: { isFlagged?: boolean; flagReason?: string | null; isPublished?: boolean }) =>
    http.patch<Record<string, unknown>>(`/admin/reviews/${reviewId}`, body),

  rewardPool: (query: { page?: number; pageSize?: number } = {}) =>
    http.get<{ pool: RewardPoolSummary; transactions: Paginated<PoolTransaction> }>('/admin/reward-pool', { params: query }),

  adjustRewardPool: (body: { amount: number; reason: string }) =>
    http.post<{ pool: RewardPoolSummary }>('/admin/reward-pool/adjust', body),

  listBadges: () =>
    http.get<
      Array<{
        id: string;
        tier: string;
        awardedAt: string;
        isActive: boolean;
        notes: string | null;
        instructor: { id: string; fullName: string; email: string; avatarUrl: string | null };
      }>
    >('/admin/badges'),

  awardBadge: (instructorId: string, body: { tier: string; notes?: string }) =>
    http.post<{ tier: string; revoked: boolean }>(`/admin/instructors/${instructorId}/badge`, body),

  recomputeReputation: () => http.post<{ instructorsProcessed: number; changes: unknown[] }>('/admin/reputation/recompute'),

  extendDeadline: (attemptId: string, body: { days: number; reason: string }) =>
    http.post<Record<string, unknown>>(`/admin/attempts/${attemptId}/extend-deadline`, body),

  settleAttempt: (attemptId: string) =>
    http.post<{ outcome: string; forfeitedPoints: number; detail?: string }>(`/admin/attempts/${attemptId}/settle`),

  releaseStakes: (attemptId: string, body: { reason: string }) =>
    http.post<{ releasedPoints: number }>(`/admin/attempts/${attemptId}/release-stakes`, body),

  runDeadlineEngine: () => http.post<Record<string, unknown>>('/admin/deadline-engine/run'),
};

export const notificationApi = {
  list: (query: { page?: number; pageSize?: number; unreadOnly?: string } = {}) =>
    http.get<Paginated<NotificationRow> & { unreadCount: number }>('/notifications', { params: query }),

  unreadCount: () => http.get<{ unreadCount: number }>('/notifications/unread-count'),

  markRead: (id: string) => http.post<NotificationRow>(`/notifications/${id}/read`),

  markAllRead: () => http.post<{ updated: number }>('/notifications/read-all'),
};

export const publicApi = {
  instructor: (instructorId: string) => http.get<InstructorProfilePublic>(`/instructors/${instructorId}`),

  health: () => http.get<{ status: string; database: string; uptimeSeconds: number }>('/health'),
};
