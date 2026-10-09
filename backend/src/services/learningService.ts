import type { ContentProgress, ContentType, CourseAttempt, Prisma } from '@prisma/client';
import { prisma, withTransaction, type PrismaTransactionClient } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { computeUnlocks, progressPercent } from '../lib/sequence';
import { computePacing } from '../lib/pacing';
import { computeWatchProgress, validateHeartbeat, type Segment } from '../lib/watchTracking';
import { env } from '../config/env';
import { MIN_TRACKED_SEGMENT_SECONDS, READING_COMPLETION_THRESHOLD } from '../config/constants';
import { roundTo } from '../utils/date';

type Tx = PrismaTransactionClient;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

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
  progress: {
    status: ContentProgress['status'];
    watchedSeconds: number;
    validWatchPercent: number;
    lastPositionSeconds: number;
    readingReachedEnd: boolean;
    comprehensionPassed: boolean | null;
    usesComprehensionCheck: boolean;
    activeSeconds: number;
    completedAt: Date | null;
  };
  quiz: { id: string; passingScore: number; passed: boolean; bestPercentage: number | null; attemptsUsed: number; maxAttempts: number | null } | null;
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
  isCurrent: boolean;
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

type AttemptWithContext = Prisma.CourseAttemptGetPayload<{
  include: {
    enrollment: true;
    course: {
      include: {
        modules: { include: { contents: { include: { quiz: true; assessment: true } } } };
        assessments: true;
      };
    };
    progress: true;
    quizAttempts: true;
    submissions: true;
    stakes: true;
  };
}>;

/* -------------------------------------------------------------------------- */
/* Context loading                                                             */
/* -------------------------------------------------------------------------- */

/** Narrows a Prisma JSON column into validated `[start, end]` watch segments. */
function jsonToSegments(value: Prisma.JsonValue | null | undefined): Segment[] {
  if (!Array.isArray(value)) return [];

  const segments: Segment[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const start = Number(entry[0]);
    const end = Number(entry[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) segments.push([start, end]);
  }
  return segments;
}

export function assertAttemptActive(attempt: Pick<CourseAttempt, 'status' | 'graceDeadline' | 'normalDeadline'>): void {
  if (attempt.status === 'COMPLETED') {
    throw conflict('This course attempt is already complete.', 'ATTEMPT_NOT_ACTIVE');
  }
  if (attempt.status === 'FAILED' || attempt.status === 'ABANDONED') {
    throw conflict('This attempt has been closed. Start a retry to continue learning.', 'ATTEMPT_NOT_ACTIVE');
  }
  if (Date.now() > attempt.graceDeadline.getTime()) {
    throw unprocessable(
      'The deadline for this attempt has passed. Start a retry to continue.',
      'DEADLINE_MISSED',
      { normalDeadline: attempt.normalDeadline, graceDeadline: attempt.graceDeadline },
    );
  }
}

export const LearningService = {
  async loadAttempt(attemptId: string, userId: string): Promise<AttemptWithContext> {
    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: {
        enrollment: true,
        course: {
          include: {
            modules: {
              orderBy: { orderIndex: 'asc' },
              include: {
                contents: {
                  orderBy: { orderIndex: 'asc' },
                  include: { quiz: true, assessment: true },
                },
              },
            },
            assessments: true,
          },
        },
        progress: true,
        quizAttempts: true,
        submissions: true,
        stakes: true,
      },
    });

    if (!attempt) throw notFound('Course attempt');
    // Ownership check: a learner can never read another learner's attempt.
    if (attempt.userId !== userId) throw forbidden('This course attempt belongs to another learner.');
    return attempt;
  },

  /**
   * Builds the ordered learning sequence with lock states.
   *
   * Ordering rule: modules by `orderIndex`; inside a module, content by
   * `orderIndex`; the final assessment is the last item in the course.
   */
  buildSequence(attempt: AttemptWithContext) {
    const completedContentIds = new Set(
      attempt.progress.filter((progress) => progress.status === 'COMPLETED').map((progress) => progress.contentId),
    );

    const finalAssessment = attempt.course.assessments.find((assessment) => assessment.type === 'FINAL') ?? null;
    const finalPassed = finalAssessment
      ? attempt.submissions.some((submission) => submission.assessmentId === finalAssessment.id && submission.passed)
      : false;

    // Flat ordered list across the whole course — this is what enforces
    // "Module 2 stays locked until Module 1's assessment passes".
    const flat: Array<{ id: string; isRequired: boolean; moduleId: string | null }> = [];
    for (const module of attempt.course.modules) {
      for (const content of module.contents) {
        flat.push({ id: content.id, isRequired: content.isRequired, moduleId: module.id });
      }
    }
    const finalId = finalAssessment ? `final:${finalAssessment.id}` : null;
    if (finalId) flat.push({ id: finalId, isRequired: true, moduleId: null });

    const completedForSequence = new Set<string>(completedContentIds);
    if (finalPassed && finalId) completedForSequence.add(finalId);

    const { unlocked, firstIncompleteId, requiredOrder } = computeUnlocks(flat, completedForSequence);

    const moduleProgress = new Map<string, { completed: number; required: number; percent: number }>();
    for (const module of attempt.course.modules) {
      const requiredIds = module.contents.filter((content) => content.isRequired).map((content) => content.id);
      const requiredForModule = flat.filter((entry) => entry.moduleId === module.id);
      const done = requiredIds.filter((id) => completedContentIds.has(id)).length;
      moduleProgress.set(module.id, {
        completed: done,
        required: requiredIds.length,
        percent: requiredIds.length ? roundTo((done / requiredIds.length) * 100, 1) : 0,
      });
      void requiredForModule;
    }

    const progressByContent = new Map(attempt.progress.map((progress) => [progress.contentId, progress]));

    const modules: ModuleView[] = attempt.course.modules.map((module) => {
      const stats = moduleProgress.get(module.id)!;
      const contents: ContentView[] = module.contents.map((content) => {
        const progress = progressByContent.get(content.id);
        const isUnlocked = unlocked.has(content.id);
        const isCompleted = completedContentIds.has(content.id);

        // Local bindings keep the narrowing visible inside the callbacks below.
        const quizInstrument = content.quiz;
        const quizAttempts = quizInstrument
          ? attempt.quizAttempts.filter((quizAttempt) => quizAttempt.quizId === quizInstrument.id)
          : [];
        const bestQuiz = quizAttempts.length
          ? quizAttempts.reduce((best, current) => (current.percentage > best.percentage ? current : best))
          : null;
        const quizPassed = quizInstrument
          ? quizAttempts.some(
              (quizAttempt) => quizAttempt.passed || quizAttempt.percentage >= quizInstrument.passingScore,
            )
          : false;

        const assessmentInstrument = content.assessment;
        const submissions = assessmentInstrument
          ? attempt.submissions.filter((submission) => submission.assessmentId === assessmentInstrument.id)
          : [];
        const bestSubmission = submissions.length
          ? submissions.reduce((best, current) => (current.percentage > best.percentage ? current : best))
          : null;
        const assessmentPassed = assessmentInstrument
          ? submissions.some(
              (submission) => submission.passed || submission.percentage >= assessmentInstrument.passingScore,
            )
          : false;

        return {
          id: content.id,
          type: content.type,
          title: content.title,
          description: content.description,
          orderIndex: content.orderIndex,
          isRequired: content.isRequired,
          estimatedMinutes: content.estimatedMinutes,
          durationSeconds: content.durationSeconds,
          requiredWatchPercent: content.requiredWatchPercent,
          isUnlocked,
          isCompleted,
          lockReason: isUnlocked
            ? null
            : 'Complete the previous required item to unlock this content.',
          progress: {
            status: progress?.status ?? 'NOT_STARTED',
            watchedSeconds: progress?.watchedSeconds ?? 0,
            validWatchPercent: progress?.validWatchPercent ?? 0,
            lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
            readingReachedEnd: progress?.readingReachedEnd ?? false,
            comprehensionPassed: progress?.comprehensionPassed ?? null,
            usesComprehensionCheck: content.requiresComprehensionCheck,
            activeSeconds: progress?.activeSeconds ?? 0,
            completedAt: progress?.completedAt ?? null,
          },
          quiz: content.quiz
            ? {
                id: content.quiz.id,
                passingScore: content.quiz.passingScore,
                passed: quizPassed,
                bestPercentage: bestQuiz ? roundTo(bestQuiz.percentage, 2) : null,
                attemptsUsed: quizAttempts.length,
                maxAttempts: content.quiz.maxAttempts,
              }
            : null,
          assessment: content.assessment
            ? {
                id: content.assessment.id,
                title: content.assessment.title,
                passingScore: content.assessment.passingScore,
                type: content.assessment.type,
                passed: assessmentPassed,
                bestPercentage: bestSubmission ? roundTo(bestSubmission.percentage, 2) : null,
                attemptsUsed: submissions.length,
                maxAttempts: content.assessment.maxAttempts,
              }
            : null,
          isCurrent: firstIncompleteId === content.id,
        };
      });

      const isUnlocked = contents.length > 0 && contents.some((content) => content.isUnlocked);
      const isCompleted = stats.required > 0 && stats.completed === stats.required;

      return {
        id: module.id,
        title: module.title,
        summary: module.summary,
        orderIndex: module.orderIndex,
        isRequired: module.isRequired,
        isUnlocked,
        isCompleted,
        progressPercent: stats.percent,
        completedCount: stats.completed,
        requiredCount: stats.required,
        contents,
      };
    });

    const finalSubmissions = finalAssessment
      ? attempt.submissions.filter((submission) => submission.assessmentId === finalAssessment.id)
      : [];
    const bestFinal = finalSubmissions.length
      ? finalSubmissions.reduce((best, current) => (current.percentage > best.percentage ? current : best))
      : null;

    const finalView = finalAssessment
      ? {
          id: finalAssessment.id,
          title: finalAssessment.title,
          description: finalAssessment.description,
          passingScore: finalAssessment.passingScore,
          maxAttempts: finalAssessment.maxAttempts,
          timeLimitMinutes: finalAssessment.timeLimitMinutes,
          questionCount: undefined as number | undefined,
          isUnlocked: unlocked.has(`final:${finalAssessment.id}`),
          isCompleted: finalPassed,
          lockReason: unlocked.has(`final:${finalAssessment.id}`)
            ? null
            : 'Complete every required module assessment to unlock the final test.',
          attemptsUsed: finalSubmissions.length,
          bestPercentage: bestFinal ? roundTo(bestFinal.percentage, 2) : null,
          passed: finalPassed,
        }
      : null;

    const overallProgress = progressPercent(requiredOrder, completedForSequence);
    const totalRequired = requiredOrder.length;
    const completedRequired = requiredOrder.filter((id) => completedForSequence.has(id)).length;

    const nextContent = (() => {
      if (!firstIncompleteId) return null;
      if (finalId && firstIncompleteId === finalId) {
        return { kind: 'FINAL_ASSESSMENT' as const, id: finalAssessment!.id, title: finalAssessment!.title };
      }
      for (const module of modules) {
        const content = module.contents.find((entry) => entry.id === firstIncompleteId);
        if (content) return { kind: 'CONTENT' as const, id: content.id, title: content.title, type: content.type };
      }
      return null;
    })();

    return {
      modules,
      finalAssessment: finalView,
      stats: {
        totalRequired,
        completedRequired,
        overallProgressPercent: overallProgress,
        moduleCount: modules.length,
        completedModules: modules.filter((module) => module.isCompleted && module.isRequired).length,
        allModulesCompleted: modules.filter((module) => module.isRequired).every((module) => module.isCompleted),
      },
      nextContent,
    };
  },

  async getLearningState(attemptId: string, userId: string) {
    const attempt = await this.loadAttempt(attemptId, userId);
    const sequence = this.buildSequence(attempt);

    const baseStake = attempt.stakes
      .filter((stake) => stake.type === 'BASE' && stake.status === 'LOCKED')
      .reduce((sum, stake) => sum + stake.amount, 0);
    const commitmentStake = attempt.stakes
      .filter((stake) => stake.type === 'COMMITMENT' && stake.status === 'LOCKED')
      .reduce((sum, stake) => sum + stake.amount, 0);

    const pacing = computePacing({
      startedAt: attempt.startedAt,
      normalDeadline: attempt.normalDeadline,
      acceleratedDeadline: attempt.acceleratedDeadline,
      graceDeadline: attempt.graceDeadline,
      actualProgressPercent: sequence.stats.overallProgressPercent,
      atRiskThresholdPercent: env.AT_RISK_THRESHOLD_PERCENT,
    });

    const course = attempt.course;

    return {
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt,
        normalDeadline: attempt.normalDeadline,
        acceleratedDeadline: attempt.acceleratedDeadline,
        graceDeadline: attempt.graceDeadline,
        completedAt: attempt.completedAt,
        moduleScore: attempt.moduleScore,
        finalTestScore: attempt.finalTestScore,
        finalScore: attempt.finalScore,
        commitmentMet: attempt.commitmentMet,
        performanceBonusAwarded: attempt.performanceBonusAwarded,
        pointsAwarded: attempt.pointsAwarded,
        pointsForfeited: attempt.pointsForfeited,
        settledAt: attempt.failedAt ?? attempt.completedAt,
      },
      course: {
        id: course.id,
        code: course.code,
        slug: course.slug,
        title: course.title,
        shortDescription: course.shortDescription,
        category: course.category,
        difficulty: course.difficulty,
        instructorId: course.instructorId,
        durationDays: course.durationDays,
        gracePeriodHours: course.gracePeriodHours,
        moduleWeight: course.moduleWeight,
        finalTestWeight: course.finalTestWeight,
        minFinalTestScore: course.minFinalTestScore,
        performanceThreshold: course.performanceThreshold,
        requiredWatchPercent: course.requiredWatchPercent,
        maxAttempts: course.maxAttempts,
        baseStake: course.baseStake,
        completionReward: course.completionReward,
        commitmentBonus: course.commitmentBonus,
        performanceBonus: course.performanceBonus,
      },
      enrollmentId: attempt.enrollmentId,
      modules: sequence.modules,
      finalAssessment: sequence.finalAssessment,
      nextContent: sequence.nextContent,
      progress: sequence.stats,
      deadline: {
        ...pacing,
        potentialReward:
          attempt.stakes.reduce((sum, stake) => sum + stake.amount, 0) +
          course.completionReward +
          (commitmentStake > 0 ? course.commitmentBonus : 0) +
          course.performanceBonus,
      },
      stake: {
        baseStake,
        commitmentStake,
        totalStaked: baseStake + commitmentStake,
        baseStakeAmount: course.baseStake,
        completionReward: course.completionReward,
        commitmentBonus: course.commitmentBonus,
        performanceBonus: course.performanceBonus,
        performanceThreshold: course.performanceThreshold,
      },
      rules: {
        requiredWatchPercent: course.requiredWatchPercent,
        minFinalTestScore: course.minFinalTestScore,
        performanceThreshold: course.performanceThreshold,
        moduleWeight: course.moduleWeight,
        finalTestWeight: course.finalTestWeight,
        maxAttempts: course.maxAttempts,
      },
    };
  },

  /* ---------------------------------------------------------------------- */
  /* Access control                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Server-side lock enforcement. Even if the client crafts a direct API call
   * for a locked item, this rejects it.
   */
  async assertContentUnlocked(attempt: AttemptWithContext, contentId: string) {
    const content = attempt.course.modules.flatMap((module) => module.contents).find((entry) => entry.id === contentId);
    if (!content) throw notFound('Content');

    const sequence = this.buildSequence(attempt);
    const view = sequence.modules.flatMap((module) => module.contents).find((entry) => entry.id === contentId);

    if (!view || !view.isUnlocked) {
      throw unprocessable('This content is locked until the previous required item is completed.', 'CONTENT_LOCKED', {
        contentId,
        hint: 'Complete the preceding required content first.',
      });
    }

    return { content, view, sequence };
  },

  /** Returns a sanitised single content payload for the learning player. */
  async getContent(attemptId: string, contentId: string, userId: string) {
    const attempt = await this.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);
    const { content, view, sequence } = await this.assertContentUnlocked(attempt, contentId);

    const module = attempt.course.modules.find((entry) => entry.id === content.moduleId)!;

    const base = {
      content: view,
      module: {
        id: module.id,
        title: module.title,
        orderIndex: module.orderIndex,
        position: module.contents.findIndex((entry) => entry.id === contentId) + 1,
        total: module.contents.length,
      },
      course: { id: attempt.course.id, title: attempt.course.title, code: attempt.course.code },
      attempt: { id: attempt.id, attemptNumber: attempt.attemptNumber, status: attempt.status },
      navigation: {
        nextContentId: module.contents[module.contents.findIndex((entry) => entry.id === contentId) + 1]?.id ?? null,
        previousContentId: module.contents[module.contents.findIndex((entry) => entry.id === contentId) - 1]?.id ?? null,
        nextModuleUnlockHint: 'Complete this module\'s assessment to unlock the next module.',
      },
      progress: sequence.stats,
      nextContent: sequence.nextContent,
    };

    if (content.type === 'VIDEO') {
      return {
        ...base,
        payload: {
          kind: 'VIDEO' as const,
          videoUrl: content.videoUrl,
          durationSeconds: content.durationSeconds ?? 0,
          requiredWatchPercent: content.requiredWatchPercent ?? attempt.course.requiredWatchPercent,
        },
      };
    }

    if (content.type === 'READING') {
      return {
        ...base,
        payload: {
          kind: 'READING' as const,
          body: content.readingBody,
          requiresComprehensionCheck: content.requiresComprehensionCheck,
          // The answer key is never sent to the client.
          comprehensionPrompt: content.requiresComprehensionCheck ? content.comprehensionPrompt : null,
          completionThreshold: READING_COMPLETION_THRESHOLD,
        },
      };
    }

    if (content.type === 'QUIZ' && content.quiz) {
      return { ...base, payload: { kind: 'QUIZ' as const, quizId: content.quiz.id, passingScore: content.quiz.passingScore } };
    }

    if (content.type === 'MODULE_ASSESSMENT' && content.assessment) {
      return {
        ...base,
        payload: {
          kind: 'MODULE_ASSESSMENT' as const,
          assessmentId: content.assessment.id,
          passingScore: content.assessment.passingScore,
        },
      };
    }

    return { ...base, payload: { kind: 'UNSUPPORTED' as const } };
  },

  /* ---------------------------------------------------------------------- */
  /* Progress tracking                                                       */
  /* ---------------------------------------------------------------------- */

  async getOrCreateProgress(tx: Tx, attemptId: string, contentId: string, userId: string): Promise<ContentProgress> {
    const existing = await tx.contentProgress.findUnique({
      where: { attemptId_contentId: { attemptId, contentId } },
    });
    if (existing) return existing;

    return tx.contentProgress.create({
      data: { attemptId, contentId, userId, status: 'IN_PROGRESS', firstAccessedAt: new Date() },
    });
  },

  /**
   * Records a video heartbeat. Returns whether the video now satisfies the
   * valid-watch requirement (it does NOT auto-complete the content — the
   * learner still confirms, so the UI can show the completion state).
   */
  async recordVideoProgress(
    attemptId: string,
    contentId: string,
    userId: string,
    input: {
      positionSeconds: number;
      fromSeconds?: number;
      elapsedRealSeconds?: number;
      durationSeconds?: number;
      playbackRate?: number;
      activeSeconds?: number;
    },
  ) {
    const attempt = await this.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);
    const { content, view } = await this.assertContentUnlocked(attempt, contentId);

    if (content.type !== 'VIDEO') {
      throw badRequest('This endpoint only accepts progress for video content.', { type: content.type });
    }

    const durationSeconds = Number(input.durationSeconds ?? content.durationSeconds ?? 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw badRequest('A positive video duration is required to verify watch progress.');
    }

    const requiredPercent = content.requiredWatchPercent ?? attempt.course.requiredWatchPercent;
    const existingProgress = attempt.progress.find((progress) => progress.contentId === contentId);
    const existingSegments = jsonToSegments(existingProgress?.watchedSegments);

    // Only trust a heartbeat when the client tells us how long it really took.
    const fromSeconds = Number.isFinite(input.fromSeconds as number)
      ? (input.fromSeconds as number)
      : existingProgress?.lastPositionSeconds ?? 0;

    const heartbeat = validateHeartbeat({
      fromSeconds,
      toSeconds: Number(input.positionSeconds ?? 0),
      elapsedRealSeconds: Number(input.elapsedRealSeconds ?? 0),
      durationSeconds,
    });

    const watch = computeWatchProgress({
      existingSegments,
      newSegment: heartbeat.segment,
      durationSeconds,
      requiredPercent,
    });

    const updated = await withTransaction(async (tx) => {
      const progress = await this.getOrCreateProgress(tx, attemptId, contentId, userId);
      return tx.contentProgress.update({
        where: { id: progress.id },
        data: {
          status: watch.isComplete ? progress.status : progress.status === 'NOT_STARTED' ? 'IN_PROGRESS' : progress.status,
          watchedSegments: watch.segments as unknown as Prisma.InputJsonValue,
          watchedSeconds: Math.round(watch.watchedSeconds),
          validWatchPercent: watch.validPercent,
          lastPositionSeconds: Number.isFinite(input.positionSeconds) ? input.positionSeconds : progress.lastPositionSeconds,
          activeSeconds: { increment: Math.max(0, Math.round(Number(input.activeSeconds ?? 0))) },
          firstAccessedAt: progress.firstAccessedAt ?? new Date(),
        },
      });
    });

    void view;

    return {
      watchedSeconds: updated.watchedSeconds,
      validWatchPercent: updated.validWatchPercent,
      requiredWatchPercent: requiredPercent,
      isWatchRequirementMet: watch.isComplete,
      suspicious: heartbeat.suspicious,
      notice: heartbeat.suspicious
        ? heartbeat.reason
        : 'Scrubbing ahead does not credit completion time.',
      segments: watch.segments,
      status: updated.status,
    };
  },

  /** Reading heartbeat: tracks that the learner actually reached the end. */
  async recordReadingProgress(
    attemptId: string,
    contentId: string,
    userId: string,
    input: { scrollPercent?: number; reachedEnd?: boolean; activeSeconds?: number },
  ) {
    const attempt = await this.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);
    const { content } = await this.assertContentUnlocked(attempt, contentId);

    if (content.type !== 'READING') {
      throw badRequest('This endpoint only accepts progress for reading content.', { type: content.type });
    }

    const scrollPercent = Math.min(100, Math.max(0, Number(input.scrollPercent ?? 0)));
    const reachedEnd = Boolean(input.reachedEnd) || scrollPercent / 100 >= READING_COMPLETION_THRESHOLD;

    const updated = await withTransaction(async (tx) => {
      const progress = await this.getOrCreateProgress(tx, attemptId, contentId, userId);
      return tx.contentProgress.update({
        where: { id: progress.id },
        data: {
          status: progress.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          readingReachedEnd: progress.readingReachedEnd || reachedEnd,
          lastPositionSeconds: Math.round(scrollPercent),
          activeSeconds: { increment: Math.max(0, Math.round(Number(input.activeSeconds ?? 0))) },
          firstAccessedAt: progress.firstAccessedAt ?? new Date(),
        },
      });
    });

    return {
      readingReachedEnd: updated.readingReachedEnd,
      requiresComprehensionCheck: content.requiresComprehensionCheck,
      comprehensionPassed: updated.comprehensionPassed,
    };
  },

  /** Optional comprehension check attached to a reading item. */
  async submitComprehension(attemptId: string, contentId: string, userId: string, answer: string) {
    const attempt = await this.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);
    const { content } = await this.assertContentUnlocked(attempt, contentId);

    if (content.type !== 'READING' || !content.requiresComprehensionCheck) {
      throw badRequest('This reading has no comprehension check.', { contentId });
    }

    const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
    const expected = content.comprehensionAnswer ?? '';
    const passed = Boolean(expected) && normalize(answer) === normalize(expected);

    const progress = await withTransaction(async (tx) => {
      const existing = await this.getOrCreateProgress(tx, attemptId, contentId, userId);
      return tx.contentProgress.update({
        where: { id: existing.id },
        data: { comprehensionPassed: passed },
      });
    });

    return {
      passed,
      comprehensionPassed: progress.comprehensionPassed,
      // Give a nudge without leaking the answer key.
      feedback: passed ? 'Comprehension check passed.' : 'That does not match the expected answer. Re-read the section and try again.',
    };
  },

  /**
   * Evaluates whether a content item satisfies its completion rule.
   * Exported so tests can assert each content type independently.
   */
  evaluateCompletion(params: {
    content: {
      type: ContentType;
      requiresComprehensionCheck: boolean;
      durationSeconds?: number | null;
      requiredWatchPercent?: number | null;
    };
    progress: ContentProgress | undefined;
    courseRequiredWatchPercent: number;
    quizPassed: boolean;
    assessmentPassed: boolean;
  }): { complete: boolean; reason: string; requirement: string } {
    const { content, progress, courseRequiredWatchPercent, quizPassed, assessmentPassed } = params;

    switch (content.type) {
      case 'VIDEO': {
        const requiredPercent = content.requiredWatchPercent ?? courseRequiredWatchPercent;
        const validPercent = progress?.validWatchPercent ?? 0;
        const complete = validPercent >= requiredPercent;
        return {
          complete,
          reason: complete
            ? 'Valid watch requirement met.'
            : `Only ${validPercent.toFixed(0)}% of the video has been verified as watched (${requiredPercent}% required).`,
          requirement: `WATCH_${requiredPercent}_PERCENT`,
        };
      }
      case 'READING': {
        const reachedEnd = progress?.readingReachedEnd ?? false;
        const comprehensionOk = !content.requiresComprehensionCheck || progress?.comprehensionPassed === true;
        const complete = reachedEnd && comprehensionOk;
        return {
          complete,
          reason: complete
            ? 'Reading completed.'
            : !reachedEnd
              ? 'Scroll to the end of the reading to complete it.'
              : 'Pass the comprehension check to complete this reading.',
          requirement: content.requiresComprehensionCheck ? 'READING_END_AND_COMPREHENSION' : 'READING_END',
        };
      }
      case 'QUIZ':
        return {
          complete: quizPassed,
          reason: quizPassed ? 'Quiz passed.' : 'Submit a passing quiz attempt to continue.',
          requirement: 'QUIZ_PASS',
        };
      case 'MODULE_ASSESSMENT':
        return {
          complete: assessmentPassed,
          reason: assessmentPassed ? 'Module assessment passed.' : 'Submit a passing module assessment to continue.',
          requirement: 'MODULE_ASSESSMENT_PASS',
        };
      case 'CODING':
        return {
          complete: progress?.status === 'COMPLETED',
          reason:
            progress?.status === 'COMPLETED'
              ? 'Coding exercise accepted.'
              : 'Submit the coding exercise for evaluation to continue.',
          requirement: 'CODING_EVALUATED',
        };
      case 'SUBJECTIVE':
        return {
          complete: progress?.status === 'COMPLETED',
          reason:
            progress?.status === 'COMPLETED'
              ? 'Written response reviewed.'
              : 'Submit the written response for review to continue.',
          requirement: 'SUBJECTIVE_REVIEWED',
        };
      default:
        return { complete: false, reason: 'Unsupported content type.', requirement: 'UNKNOWN' };
    }
  },

  /**
   * Marks a content item complete once its rule is satisfied. Module and
   * final-test unlocking are derived from completion state, so nothing else
   * needs to be written here.
   */
  async completeContent(attemptId: string, contentId: string, userId: string) {
    const attempt = await this.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);
    const { content } = await this.assertContentUnlocked(attempt, contentId);

    const progress = attempt.progress.find((entry) => entry.contentId === contentId);
    const quizInstrument = content.quiz;
    const assessmentInstrument = content.assessment;

    const quizPassed = quizInstrument
      ? attempt.quizAttempts.some(
          (quizAttempt) =>
            quizAttempt.quizId === quizInstrument.id &&
            (quizAttempt.passed || quizAttempt.percentage >= quizInstrument.passingScore),
        )
      : false;
    const assessmentPassed = assessmentInstrument
      ? attempt.submissions.some(
          (submission) =>
            submission.assessmentId === assessmentInstrument.id &&
            (submission.passed || submission.percentage >= assessmentInstrument.passingScore),
        )
      : false;

    const evaluation = this.evaluateCompletion({
      content: {
        type: content.type,
        requiresComprehensionCheck: content.requiresComprehensionCheck,
        durationSeconds: content.durationSeconds,
        requiredWatchPercent: content.requiredWatchPercent,
      },
      progress,
      courseRequiredWatchPercent: attempt.course.requiredWatchPercent,
      quizPassed,
      assessmentPassed,
    });

    if (!evaluation.complete) {
      throw unprocessable(
        `This content cannot be completed yet. ${evaluation.reason}`,
        'INVALID_PROGRESS',
        { contentId, requirement: evaluation.requirement },
      );
    }

    const updated = await withTransaction(async (tx) => {
      const existing = await this.getOrCreateProgress(tx, attemptId, contentId, userId);
      if (existing.status === 'COMPLETED') return existing;
      return tx.contentProgress.update({
        where: { id: existing.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    });

    // Recompute the sequence so the response can tell the client what unlocked.
    const refreshed = await this.loadAttempt(attemptId, userId);
    const sequence = this.buildSequence(refreshed);

    return {
      contentId,
      status: updated.status,
      completedAt: updated.completedAt,
      requirement: evaluation.requirement,
      progress: sequence.stats,
      unlocked: {
        nextContent: sequence.nextContent,
        finalAssessmentUnlocked: sequence.finalAssessment?.isUnlocked ?? false,
        modules: sequence.modules
          .filter((module) => module.isUnlocked)
          .map((module) => ({ id: module.id, title: module.title, isCompleted: module.isCompleted })),
      },
    };
  },

  async getModule(attemptId: string, moduleId: string, userId: string) {
    const attempt = await this.loadAttempt(attemptId, userId);
    const sequence = this.buildSequence(attempt);
    const module = sequence.modules.find((entry) => entry.id === moduleId);
    if (!module) throw notFound('Module');
    return module;
  },

  /** Aggregate progress used by dashboard cards. */
  async summarizeAttemptProgress(attemptIds: string[]): Promise<Map<string, number>> {
    if (attemptIds.length === 0) return new Map();

    const attempts = await prisma.courseAttempt.findMany({
      where: { id: { in: attemptIds } },
      include: {
        course: {
          include: {
            modules: { include: { contents: { select: { id: true, isRequired: true } } } },
            assessments: { where: { type: 'FINAL' }, select: { id: true } },
          },
        },
        progress: { select: { contentId: true, status: true } },
        submissions: { select: { assessmentId: true, passed: true } },
      },
    });

    const result = new Map<string, number>();

    for (const attempt of attempts) {
      const completed = new Set(
        attempt.progress.filter((progress) => progress.status === 'COMPLETED').map((progress) => progress.contentId),
      );
      const flat: Array<{ id: string; isRequired: boolean }> = [];
      for (const module of attempt.course.modules) {
        for (const content of module.contents) flat.push({ id: content.id, isRequired: content.isRequired });
      }
      const finalAssessment = attempt.course.assessments[0];
      if (finalAssessment) {
        const passed = attempt.submissions.some(
          (submission) => submission.assessmentId === finalAssessment.id && submission.passed,
        );
        if (passed) completed.add(`final:${finalAssessment.id}`);
        flat.push({ id: `final:${finalAssessment.id}`, isRequired: true });
      }
      const { requiredOrder } = computeUnlocks(flat, completed);
      result.set(attempt.id, progressPercent(requiredOrder, completed));
    }

    return result;
  },

  constants: { MIN_TRACKED_SEGMENT_SECONDS },
};

