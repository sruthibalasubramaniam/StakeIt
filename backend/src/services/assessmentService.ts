import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors';
import { gradeQuestions, isPassing, normalizeAnswerMap } from '../lib/grading';
import { LearningService, assertAttemptActive } from './learningService';
import { CompletionService, computeModuleScore } from './completionService';
import { roundTo } from '../utils/date';

export const AssessmentService = {
  /**
   * Sanitised assessment payload.
   *
   * MODULE assessments require their content item to be unlocked; the FINAL
   * assessment additionally requires every required module to be complete —
   * the backend is the gate, not the disabled button in the UI.
   */
  async getAssessment(assessmentId: string, attemptId: string, userId: string) {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: {
        module: true,
        questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
      },
    });
    if (!assessment) throw notFound('Assessment');

    const attempt = await LearningService.loadAttempt(attemptId, userId);
    const sequence = LearningService.buildSequence(attempt);

    if (assessment.type === 'MODULE') {
      if (!assessment.contentId) throw badRequest('Module assessment is missing its content link.');
      await LearningService.assertContentUnlocked(attempt, assessment.contentId);
    } else if (!sequence.finalAssessment?.isUnlocked) {
      throw unprocessable(
        'The final course assessment is locked until every required module is completed.',
        'FINAL_TEST_LOCKED',
        {
          modulesRemaining: sequence.modules
            .filter((module) => module.isRequired && !module.isCompleted)
            .map((module) => ({ id: module.id, title: module.title, progressPercent: module.progressPercent })),
        },
      );
    }

    const submissions = await prisma.assessmentSubmission.findMany({
      where: { assessmentId, attemptId, userId },
      orderBy: { attemptNumber: 'desc' },
    });
    const best = submissions.length
      ? submissions.reduce((bestEntry, current) => (current.percentage > bestEntry.percentage ? current : bestEntry))
      : null;

    return {
      assessment: {
        id: assessment.id,
        type: assessment.type,
        title: assessment.title,
        description: assessment.description,
        passingScore: assessment.passingScore,
        maxAttempts: assessment.maxAttempts,
        timeLimitMinutes: assessment.timeLimitMinutes,
        totalPoints: assessment.questions.reduce((sum, question) => sum + question.points, 0),
        minFinalTestScore: attempt.course.minFinalTestScore,
      },
      module: assessment.module ? { id: assessment.module.id, title: assessment.module.title } : null,
      course: {
        id: attempt.course.id,
        title: attempt.course.title,
        code: attempt.course.code,
        moduleWeight: attempt.course.moduleWeight,
        finalTestWeight: attempt.course.finalTestWeight,
        performanceThreshold: attempt.course.performanceThreshold,
        performanceBonus: attempt.course.performanceBonus,
      },
      questions: assessment.questions.map((question) => ({
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        points: question.points,
        orderIndex: question.orderIndex,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          detail: option.detail,
          orderIndex: option.orderIndex,
        })),
      })),
      attemptInfo: {
        attemptsUsed: submissions.length,
        attemptsRemaining:
          assessment.maxAttempts === null ? null : Math.max(0, assessment.maxAttempts - submissions.length),
        bestPercentage: best ? roundTo(best.percentage, 2) : null,
        passed: submissions.some((submission) => submission.passed),
        lastAttempt: submissions[0]
          ? {
              attemptNumber: submissions[0].attemptNumber,
              percentage: submissions[0].percentage,
              passed: submissions[0].passed,
              status: submissions[0].status,
              submittedAt: submissions[0].submittedAt,
            }
          : null,
      },
      isFinal: assessment.type === 'FINAL',
    };
  },

  async submitAssessment(
    assessmentId: string,
    attemptId: string,
    userId: string,
    input: { answers: unknown; timeSpentSeconds?: number },
  ) {
    const attempt = await LearningService.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } },
    });
    if (!assessment) throw notFound('Assessment');

    const sequence = LearningService.buildSequence(attempt);
    if (assessment.type === 'MODULE') {
      if (!assessment.contentId) throw badRequest('Module assessment is missing its content link.');
      await LearningService.assertContentUnlocked(attempt, assessment.contentId);
    } else if (!sequence.finalAssessment?.isUnlocked) {
      throw unprocessable(
        'The final course assessment is locked until every required module is completed.',
        'FINAL_TEST_LOCKED',
        { modulesRemaining: sequence.modules.filter((module) => module.isRequired && !module.isCompleted).length },
      );
    }

    if (assessment.questions.length === 0) {
      throw unprocessable('This assessment has no questions yet.', 'INVALID_PROGRESS');
    }

    const previousCount = await prisma.assessmentSubmission.count({ where: { assessmentId, attemptId, userId } });
    if (assessment.maxAttempts !== null && previousCount >= assessment.maxAttempts) {
      throw unprocessable('You have used all available attempts for this assessment.', 'ATTEMPT_LIMIT_REACHED', {
        maxAttempts: assessment.maxAttempts,
        attemptsUsed: previousCount,
      });
    }

    const answers = normalizeAnswerMap(input.answers);
    const grade = gradeQuestions(
      assessment.questions.map((question) => ({
        id: question.id,
        type: question.type,
        points: question.points,
        options: question.options.map((option) => ({ id: option.id, isCorrect: option.isCorrect })),
      })),
      answers,
    );

    let passed = isPassing(grade, assessment.passingScore);

    // A module/final assessment must also clear the course's minimum score
    // when the instructor configured one on the final test.
    if (passed && assessment.type === 'FINAL' && attempt.course.minFinalTestScore !== null) {
      if (grade.percentage < attempt.course.minFinalTestScore) {
        passed = false;
      }
    }

    const saved = await withTransaction(async (tx) => {
      const created = await tx.assessmentSubmission.create({
        data: {
          assessmentId,
          userId,
          attemptId,
          attemptNumber: previousCount + 1,
          answers: answers as never,
          score: grade.score,
          maxScore: grade.maxScore,
          percentage: grade.percentage,
          passed,
          status: grade.hasPendingReview ? 'PENDING_REVIEW' : 'AUTO_GRADED',
          timeSpentSeconds: input.timeSpentSeconds ?? null,
          gradedAt: grade.hasPendingReview ? null : new Date(),
        },
      });

      if (passed) {
        await tx.courseAttempt.update({
          where: { id: attemptId },
          data: {
            finalTestScore: assessment.type === 'FINAL' ? grade.percentage : undefined,
            // Keep the attempt's module score fresh as graded work lands.
            moduleScore: assessment.type === 'MODULE' ? await computeModuleScore(tx, attemptId) : undefined,
          },
        });

        if (assessment.contentId) {
          const existing = await tx.contentProgress.findUnique({
            where: { attemptId_contentId: { attemptId, contentId: assessment.contentId } },
          });
          if (existing) {
            await tx.contentProgress.update({
              where: { id: existing.id },
              data: { status: 'COMPLETED', completedAt: existing.completedAt ?? new Date() },
            });
          } else {
            await tx.contentProgress.create({
              data: {
                attemptId,
                contentId: assessment.contentId,
                userId,
                status: 'COMPLETED',
                completedAt: new Date(),
                firstAccessedAt: new Date(),
              },
            });
          }
        }
      }

      return created;
    });

    const refreshed = await LearningService.loadAttempt(attemptId, userId);
    const refreshedSequence = LearningService.buildSequence(refreshed);

    const review = assessment.questions.map((question, index) => {
      const result = grade.results[index]!;
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: question.type,
        correct: result.correct,
        pendingReview: result.pendingReview,
        awarded: result.awarded,
        maxPoints: result.maxPoints,
        selectedOptionIds: result.selectedOptionIds,
        correctOptionIds: result.correctOptionIds,
        explanation: question.explanation,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          detail: option.detail,
          isCorrect: option.isCorrect,
          selected: result.selectedOptionIds.includes(option.id),
        })),
      };
    });

    // Passing the final assessment settles the whole course (stake + rewards)
    // inside its own transaction and returns the settlement receipt.
    let settlement: Awaited<ReturnType<typeof CompletionService.settleSuccessfulCompletion>> | null = null;
    if (passed && assessment.type === 'FINAL') {
      settlement = await CompletionService.settleSuccessfulCompletion(attemptId);
    }

    const attemptsRemaining =
      assessment.maxAttempts === null ? null : Math.max(0, assessment.maxAttempts - (previousCount + 1));

    return {
      submission: {
        id: saved.id,
        attemptNumber: saved.attemptNumber,
        score: saved.score,
        maxScore: saved.maxScore,
        percentage: saved.percentage,
        passed: saved.passed,
        status: saved.status,
        submittedAt: saved.submittedAt,
      },
      passingScore: assessment.passingScore,
      minFinalTestScore: assessment.type === 'FINAL' ? attempt.course.minFinalTestScore : null,
      correctCount: grade.correctCount,
      totalQuestions: grade.totalQuestions,
      hasPendingReview: grade.hasPendingReview,
      isFinal: assessment.type === 'FINAL',
      attemptsRemaining,
      mayRetry: !passed && (attemptsRemaining === null || attemptsRemaining > 0),
      missedMinimum: assessment.type === 'FINAL' && attempt.course.minFinalTestScore !== null
        ? grade.percentage < attempt.course.minFinalTestScore
        : false,
      review,
      progress: refreshedSequence.stats,
      settlement,
    };
  },

  async getResults(assessmentId: string, attemptId: string, userId: string) {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } },
    });
    if (!assessment) throw notFound('Assessment');

    const submissions = await prisma.assessmentSubmission.findMany({
      where: { assessmentId, attemptId, userId },
      orderBy: { attemptNumber: 'desc' },
    });
    const latest = submissions[0];
    const answers = normalizeAnswerMap(latest?.answers);
    const best = submissions.length
      ? submissions.reduce((bestEntry, current) => (current.percentage > bestEntry.percentage ? current : bestEntry))
      : null;

    return {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        type: assessment.type,
        passingScore: assessment.passingScore,
        maxAttempts: assessment.maxAttempts,
      },
      attemptsUsed: submissions.length,
      attemptsRemaining:
        assessment.maxAttempts === null ? null : Math.max(0, assessment.maxAttempts - submissions.length),
      best: best
        ? { attemptNumber: best.attemptNumber, percentage: best.percentage, passed: best.passed, submittedAt: best.submittedAt }
        : null,
      history: submissions.map((entry) => ({
        attemptNumber: entry.attemptNumber,
        score: entry.score,
        maxScore: entry.maxScore,
        percentage: entry.percentage,
        passed: entry.passed,
        status: entry.status,
        submittedAt: entry.submittedAt,
        reviewNotes: entry.reviewNotes,
      })),
      review:
        latest === undefined
          ? null
          : assessment.questions.map((question) => ({
              questionId: question.id,
              prompt: question.prompt,
              type: question.type,
              explanation: question.explanation,
              selectedOptionIds: answers[question.id] ?? [],
              options: question.options.map((option) => ({
                id: option.id,
                label: option.label,
                isCorrect: option.isCorrect,
                selected: (answers[question.id] ?? []).includes(option.id),
              })),
            })),
    };
  },

  /** Instructor/admin: grade a subjective submission and (optionally) pass it. */
  async manualReview(params: {
    submissionId: string;
    actorId: string;
    role: string;
    score: number;
    notes?: string;
    passed?: boolean;
  }) {
    const submission = await prisma.assessmentSubmission.findUnique({
      where: { id: params.submissionId },
      include: { assessment: { include: { course: true } } },
    });
    if (!submission) throw notFound('Submission');

    if (params.role !== 'ADMIN' && submission.assessment.course.instructorId !== params.actorId) {
      throw forbidden('You can only review submissions for your own courses.');
    }
    if (params.score < 0 || params.score > submission.maxScore) {
      throw badRequest(`Score must be between 0 and ${submission.maxScore}.`);
    }

    const percentage = submission.maxScore > 0 ? roundTo((params.score / submission.maxScore) * 100, 2) : 0;
    const passed = params.passed ?? percentage >= submission.assessment.passingScore;

    const updated = await prisma.assessmentSubmission.update({
      where: { id: params.submissionId },
      data: {
        score: params.score,
        percentage,
        passed,
        status: 'MANUALLY_GRADED',
        reviewerId: params.actorId,
        reviewNotes: params.notes ?? null,
        gradedAt: new Date(),
      },
    });

    if (passed && submission.assessment.contentId) {
      const existing = await prisma.contentProgress.findUnique({
        where: { attemptId_contentId: { attemptId: submission.attemptId, contentId: submission.assessment.contentId } },
      });
      if (existing && existing.status !== 'COMPLETED') {
        await prisma.contentProgress.update({
          where: { id: existing.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
    }

    return updated;
  },
};

