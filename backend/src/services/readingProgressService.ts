/**
 * Learner progression through a structured reading lesson.
 *
 * Every mutation here runs through the same guards as the rest of the learning
 * platform — the attempt must belong to the learner, be active, and the content
 * must be unlocked — and then applies the section rules from `lib/reading.ts`
 * server-side. A crafted request therefore cannot:
 *   - read a section before its predecessors are complete,
 *   - mark a checkpoint-guarded section read without passing the checkpoint,
 *   - write a second completion record for the same section,
 *   - complete the lesson while sections are outstanding.
 */
import type { Prisma } from '@prisma/client';
import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import {
  computeSectionUnlocks,
  evaluateReadingCompletion,
  gradeCheckpoint,
  type ReadingSectionShape,
} from '../lib/reading';
import { LearningService, assertAttemptActive } from './learningService';
import { ReadingService, isLessonPublished } from './readingService';
import { roundTo } from '../utils/date';

type Tx = Prisma.TransactionClient;
type AttemptCtx = Awaited<ReturnType<typeof LearningService.loadAttempt>>;
type ContentRow = AttemptCtx['course']['modules'][number]['contents'][number];

interface LessonContext {
  attempt: AttemptCtx;
  content: ContentRow;
  sections: Array<ReadingSectionShape & { checkpointId: string | null; hasCheckpoint: boolean }>;
  completed: Set<string>;
}

function findContent(attempt: AttemptCtx, contentId: string): ContentRow | undefined {
  return attempt.course.modules.flatMap((module) => module.contents).find((entry) => entry.id === contentId);
}

export const ReadingProgressService = {
  /**
   * Loads the lesson and enforces every access rule that must hold before a
   * learner can see or act on it.
   */
  async loadLesson(attemptId: string, contentId: string, userId: string): Promise<LessonContext> {
    const attempt = await LearningService.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);

    const content = findContent(attempt, contentId);
    if (!content) throw notFound('Content');
    if (content.type !== 'READING') throw badRequest('This content is not a reading lesson.', { type: content.type });

    // Course-level sequential unlock (the lesson must be reachable at all).
    await LearningService.assertContentUnlocked(attempt, contentId);

    const sections = await prisma.readingSection.findMany({
      where: { contentId },
      orderBy: { orderIndex: 'asc' },
      include: { checkpoint: { include: { questions: { select: { id: true } } } } },
    });

    if (!isLessonPublished({ hasSections: sections.length > 0, readingPublishedAt: content.readingPublishedAt })) {
      throw unprocessable('This reading lesson has not been published yet.', 'CONTENT_LOCKED', {
        reason: 'NOT_PUBLISHED',
        contentId,
      });
    }

    const progressRows = await prisma.readingSectionProgress.findMany({ where: { attemptId, contentId } });
    const completed = new Set(progressRows.filter((row) => row.isCompleted).map((row) => row.sectionId));

    return {
      attempt,
      content,
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        orderIndex: section.orderIndex,
        hasCheckpoint: Boolean(section.checkpoint && section.checkpoint.questions.length > 0),
        checkpointId: section.checkpoint?.id ?? null,
      })),
      completed,
    };
  },

  /** Rejects a section that is still locked by the sequential rule. */
  assertSectionUnlocked(lesson: LessonContext, sectionId: string): ReadingSectionShape {
    const section = lesson.sections.find((entry) => entry.id === sectionId);
    if (!section) throw notFound('Section');

    const { unlocked } = computeSectionUnlocks(lesson.sections, lesson.completed);
    if (!unlocked.has(sectionId)) {
      throw unprocessable('This section is locked until the previous section is complete.', 'CONTENT_LOCKED', {
        sectionId,
        hint: 'Complete the previous section first.',
      });
    }
    return section;
  },

  /** Persists the learner's position (section + PDF page) for resume. */
  async savePosition(
    attemptId: string,
    contentId: string,
    userId: string,
    input: { sectionId?: string | null; pdfPage?: number | null; activeSeconds?: number },
  ) {
    const lesson = await this.loadLesson(attemptId, contentId, userId);

    let sectionId: string | null = null;
    let sectionIndex: number | null = null;

    if (input.sectionId) {
      const section = this.assertSectionUnlocked(lesson, input.sectionId);
      sectionId = section.id;
      sectionIndex = lesson.sections.findIndex((entry) => entry.id === section.id);
    }

    if (input.pdfPage !== undefined && input.pdfPage !== null) {
      if (!Number.isInteger(input.pdfPage) || input.pdfPage < 1 || input.pdfPage > 5000) {
        throw badRequest('The PDF page must be a positive integer.');
      }
    }

    const activeSeconds = Math.max(0, Math.min(3600, Math.round(input.activeSeconds ?? 0)));

    return withTransaction(async (tx) => {
      const progress = await this.getOrCreateProgress(tx, lesson, userId);

      const updated = await tx.contentProgress.update({
        where: { id: progress.id },
        data: {
          status: progress.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          ...(sectionId ? { lastSectionId: sectionId, lastSectionIndex: sectionIndex } : {}),
          ...(input.pdfPage !== undefined && input.pdfPage !== null ? { lastPdfPage: input.pdfPage } : {}),
          activeSeconds: { increment: activeSeconds },
          firstAccessedAt: progress.firstAccessedAt ?? new Date(),
        },
      });

      if (sectionId) {
        await tx.readingSectionProgress.upsert({
          where: { attemptId_sectionId: { attemptId, sectionId } },
          create: {
            attemptId,
            contentId,
            sectionId,
            userId,
            lastViewedAt: new Date(),
          },
          update: { lastViewedAt: new Date() },
        });
      }

      return {
        lastSectionId: updated.lastSectionId,
        lastSectionIndex: updated.lastSectionIndex,
        lastPdfPage: updated.lastPdfPage,
        sectionsCompleted: updated.readingSectionsDone,
        totalSections: lesson.sections.length,
      };
    });
  },

  /**
   * Marks an unguarded section as read.
   *
   * Repeat calls are no-ops: the completion record is unique per
   * (attempt, section) and the row is only written once.
   */
  async markSectionRead(attemptId: string, contentId: string, sectionId: string, userId: string, activeSeconds = 0) {
    const lesson = await this.loadLesson(attemptId, contentId, userId);
    const section = this.assertSectionUnlocked(lesson, sectionId);

    if (section.hasCheckpoint) {
      throw unprocessable('Pass this section’s knowledge check to complete it.', 'CHECKPOINT_REQUIRED', {
        sectionId,
        checkpointRequired: true,
      });
    }

    const result = await withTransaction(async (tx) => {
      const now = new Date();
      const existing = await tx.readingSectionProgress.findUnique({
        where: { attemptId_sectionId: { attemptId, sectionId } },
      });

      if (existing?.isCompleted) {
        return { completed: true, alreadyCompleted: true };
      }

      await tx.readingSectionProgress.upsert({
        where: { attemptId_sectionId: { attemptId, sectionId } },
        create: {
          attemptId,
          contentId,
          sectionId,
          userId,
          isCompleted: true,
          completedAt: now,
          lastViewedAt: now,
        },
        update: { isCompleted: true, completedAt: now, lastViewedAt: now },
      });

      return { completed: true, alreadyCompleted: false };
    });

    const summary = await this.refreshLessonProgress(attemptId, contentId, userId, sectionId, activeSeconds);

    return {
      sectionId,
      isCompleted: true,
      alreadyCompleted: result.alreadyCompleted,
      ...summary,
    };
  },

  /**
   * Grades a checkpoint and, on success, completes its section.
   *
   * Attempts are counted per (checkpoint, attempt) and capped by `maxAttempts`.
   * A second submission is never written as a duplicate: the attempt number is
   * derived from the existing count inside the transaction and the unique index
   * is the final backstop.
   */
  async submitCheckpoint(
    attemptId: string,
    contentId: string,
    checkpointId: string,
    userId: string,
    answers: unknown,
  ) {
    const lesson = await this.loadLesson(attemptId, contentId, userId);

    const checkpoint = await prisma.readingCheckpoint.findFirst({
      where: { id: checkpointId, contentId },
      include: {
        questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
      },
    });
    if (!checkpoint) throw notFound('Checkpoint');

    const section = this.assertSectionUnlocked(lesson, checkpoint.sectionId);

    const previous = await prisma.readingSectionProgress.findUnique({
      where: { attemptId_sectionId: { attemptId, sectionId: checkpoint.sectionId } },
    });

    // Already cleared: return the stored outcome instead of writing a new row.
    if (previous?.checkpointPassed) {
      const [lastSubmission, completion] = await Promise.all([
        prisma.readingCheckpointSubmission.findFirst({
          where: { checkpointId, attemptId },
          orderBy: { attemptNumber: 'desc' },
        }),
        ReadingService.getCompletionState(attemptId, contentId),
      ]);
      return {
        passed: true,
        alreadyPassed: true,
        percentage: roundTo(lastSubmission?.percentage ?? 100, 2),
        score: lastSubmission?.score ?? 0,
        maxScore: lastSubmission?.maxScore ?? 0,
        attemptsUsed: previous.checkpointAttempts,
        attemptsRemaining: 0,
        results: [],
        sectionCompleted: true,
        lesson: {
          structured: true,
          complete: completion.complete,
          completedSections: completion.completedCount,
          totalSections: completion.totalSections,
          percent: completion.percent,
          pendingSections: completion.pendingSectionTitles,
          canCompleteLesson: completion.complete,
        },
      };
    }

    if (checkpoint.maxAttempts !== null && previous && previous.checkpointAttempts >= checkpoint.maxAttempts) {
      throw conflict(
        `You have used all ${checkpoint.maxAttempts} attempt(s) for this knowledge check. Contact your instructor if you need it reset.`,
        'ATTEMPT_LIMIT_REACHED',
        { checkpointId, maxAttempts: checkpoint.maxAttempts },
      );
    }

    if (checkpoint.questions.length === 0) {
      throw unprocessable('This knowledge check has no questions yet.', 'INVALID_PROGRESS', { checkpointId });
    }

    const graded = gradeCheckpoint(
      checkpoint.questions.map((question) => ({
        id: question.id,
        type: question.type,
        points: question.points,
        options: question.options.map((option) => ({ id: option.id, isCorrect: option.isCorrect })),
      })),
      answers,
      checkpoint.passingScore,
    );

    const now = new Date();
    const attemptsUsed = (previous?.checkpointAttempts ?? 0) + 1;

    try {
      await withTransaction(async (tx) => {
        // Attempt number = count of existing submissions + 1, computed inside
        // the transaction so two concurrent submissions cannot share a number.
        const submitted = await tx.readingCheckpointSubmission.count({ where: { checkpointId, attemptId } });

        await tx.readingCheckpointSubmission.create({
          data: {
            checkpointId,
            attemptId,
            userId,
            attemptNumber: submitted + 1,
            answers: graded.answers as unknown as Prisma.InputJsonValue,
            score: graded.score,
            maxScore: graded.maxScore,
            percentage: graded.percentage,
            passed: graded.passed,
          },
        });

        await tx.readingSectionProgress.upsert({
          where: { attemptId_sectionId: { attemptId, sectionId: checkpoint.sectionId } },
          create: {
            attemptId,
            contentId,
            sectionId: checkpoint.sectionId,
            userId,
            checkpointAttempts: 1,
            checkpointPassed: graded.passed,
            isCompleted: graded.passed,
            completedAt: graded.passed ? now : null,
            lastViewedAt: now,
          },
          update: {
            checkpointAttempts: attemptsUsed,
            checkpointPassed: previous?.checkpointPassed || graded.passed,
            ...(graded.passed ? { isCompleted: true, completedAt: now } : {}),
            lastViewedAt: now,
          },
        });
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
        throw conflict('This knowledge check submission is already being processed. Refresh and try again.');
      }
      throw error;
    }

    const summary = await this.refreshLessonProgress(attemptId, contentId, userId, checkpoint.sectionId, 0);

    return {
      passed: graded.passed,
      alreadyPassed: false,
      percentage: roundTo(graded.percentage, 2),
      score: graded.score,
      maxScore: graded.maxScore,
      correctCount: graded.correctCount,
      totalQuestions: graded.totalQuestions,
      passingScore: checkpoint.passingScore,
      attemptsUsed,
      attemptsRemaining: checkpoint.maxAttempts === null ? null : Math.max(0, checkpoint.maxAttempts - attemptsUsed),
      // Answer keys are revealed only for a passed checkpoint.
      results: graded.passed
        ? graded.results.map((result) => ({
            questionId: result.questionId,
            correct: result.correct,
            correctOptionIds: result.correctOptionIds,
          }))
        : [],
      explanations: graded.passed
        ? checkpoint.questions.map((question) => ({ questionId: question.id, explanation: question.explanation }))
        : [],
      sectionId: checkpoint.sectionId,
      sectionCompleted: graded.passed,
      ...summary,
    };
  },

  /** Signed URL for a PDF resource attached to this lesson. */
  async resourceUrl(attemptId: string, contentId: string, resourceId: string, userId: string) {
    await this.loadLesson(attemptId, contentId, userId);

    const resource = await prisma.readingResource.findFirst({ where: { id: resourceId, contentId } });
    if (!resource) throw notFound('Resource');

    const resolved = await ReadingService.describeResourceUrl(resource);
    if (!resolved.available) {
      throw unprocessable(
        'This document is temporarily unavailable. Please retry shortly or contact your instructor.',
        'SERVICE_UNAVAILABLE',
        { resourceId, reason: 'RESOURCE_NOT_AVAILABLE' },
      );
    }

    return resolved;
  },

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  async getOrCreateProgress(tx: Tx, lesson: LessonContext, userId: string) {
    const existing = await tx.contentProgress.findUnique({
      where: { attemptId_contentId: { attemptId: lesson.attempt.id, contentId: lesson.content.id } },
    });
    if (existing) return existing;

    return tx.contentProgress.create({
      data: {
        attemptId: lesson.attempt.id,
        contentId: lesson.content.id,
        userId,
        status: 'IN_PROGRESS',
        firstAccessedAt: new Date(),
      },
    });
  },

  /**
   * Recomputes the cached lesson counters after a section changes and reports
   * what to show next. Also moves the resume pointer to the next open section.
   */
  async refreshLessonProgress(
    attemptId: string,
    contentId: string,
    userId: string,
    sectionId: string,
    activeSeconds: number,
  ) {
    const [sections, rows] = await Promise.all([
      prisma.readingSection.findMany({
        where: { contentId },
        orderBy: { orderIndex: 'asc' },
        include: { checkpoint: { include: { questions: { select: { id: true } } } } },
      }),
      prisma.readingSectionProgress.findMany({ where: { attemptId, contentId } }),
    ]);

    const shapes: ReadingSectionShape[] = sections.map((section) => ({
      id: section.id,
      title: section.title,
      orderIndex: section.orderIndex,
      hasCheckpoint: Boolean(section.checkpoint && section.checkpoint.questions.length > 0),
    }));
    const completed = new Set(rows.filter((row) => row.isCompleted).map((row) => row.sectionId));
    const unlock = computeSectionUnlocks(shapes, completed);
    const completion = evaluateReadingCompletion(shapes, completed);

    const nextSection = unlock.firstIncompleteId
      ? sections.find((section) => section.id === unlock.firstIncompleteId) ?? null
      : null;

    const progress = await prisma.contentProgress.findUnique({
      where: { attemptId_contentId: { attemptId, contentId } },
    });

    if (progress) {
      await prisma.contentProgress.update({
        where: { id: progress.id },
        data: {
          readingSectionsDone: completion.completedCount,
          readingReachedEnd: completion.complete,
          // Never downgrade a completed lesson: adding a new section later must
          // not erase an earned completion.
          status: progress.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          ...(nextSection && nextSection.id !== sectionId
            ? {
                lastSectionId: nextSection.id,
                lastSectionIndex: sections.findIndex((section) => section.id === nextSection.id),
              }
            : {}),
          ...(activeSeconds > 0 ? { activeSeconds: { increment: activeSeconds } } : {}),
          firstAccessedAt: progress.firstAccessedAt ?? new Date(),
        },
      });
    }

    return {
      nextSectionId: nextSection?.id ?? null,
      nextSectionTitle: nextSection?.title ?? null,
      nextSectionLocked: nextSection ? !unlock.unlocked.has(nextSection.id) : false,
      lesson: {
        structured: true,
        complete: completion.complete,
        completedSections: completion.completedCount,
        totalSections: completion.totalSections,
        percent: completion.percent,
        pendingSections: completion.pendingSectionTitles,
        // The lesson is only marked complete through the existing
        // `POST /content/:id/complete` endpoint, which re-verifies everything.
        canCompleteLesson: completion.complete,
      },
    };
  },

  /** Full learner snapshot, used after a mutation so the UI can re-render. */
  async readerSnapshot(attemptId: string, contentId: string, userId: string) {
    const lesson = await this.loadLesson(attemptId, contentId, userId);
    return ReadingService.buildReaderPayload({ attemptId, content: lesson.content, userId });
  },
};
