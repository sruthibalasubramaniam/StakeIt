import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors';
import { gradeQuestions, isPassing, normalizeAnswerMap } from '../lib/grading';
import { LearningService, assertAttemptActive } from './learningService';
import { roundTo } from '../utils/date';

export const QuizService = {
  /**
   * Sanitised quiz payload for the learner. `isCorrect` is stripped from every
   * option — answers are only revealed after a submission.
   */
  async getQuiz(quizId: string, attemptId: string, userId: string) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        content: { include: { module: true } },
        questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
      },
    });
    if (!quiz) throw notFound('Quiz');

    // Enforces that the quiz is unlocked for this attempt.
    await LearningService.assertContentUnlocked(await LearningService.loadAttempt(attemptId, userId), quiz.contentId);

    const previousAttempts = await prisma.quizAttempt.findMany({
      where: { quizId, attemptId, userId },
      orderBy: { attemptNumber: 'desc' },
    });
    const best = previousAttempts.length
      ? previousAttempts.reduce((bestAttempt, current) => (current.percentage > bestAttempt.percentage ? current : bestAttempt))
      : null;

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        passingScore: quiz.passingScore,
        maxAttempts: quiz.maxAttempts,
        timeLimitMinutes: quiz.timeLimitMinutes,
        totalPoints: quiz.questions.reduce((sum, question) => sum + question.points, 0),
      },
      module: { id: quiz.content.module.id, title: quiz.content.module.title },
      questions: quiz.questions.map((question) => ({
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
        attemptsUsed: previousAttempts.length,
        attemptsRemaining: quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - previousAttempts.length),
        bestPercentage: best ? roundTo(best.percentage, 2) : null,
        passed: previousAttempts.some((entry) => entry.passed),
        lastAttempt:
          previousAttempts[0] !== undefined
            ? {
                attemptNumber: previousAttempts[0].attemptNumber,
                percentage: previousAttempts[0].percentage,
                passed: previousAttempts[0].passed,
                submittedAt: previousAttempts[0].submittedAt,
              }
            : null,
      },
      navigation: { courseContentId: quiz.contentId },
    };
  },

  async submitQuiz(
    quizId: string,
    attemptId: string,
    userId: string,
    input: { answers: unknown; timeSpentSeconds?: number },
  ) {
    const attempt = await LearningService.loadAttempt(attemptId, userId);
    assertAttemptActive(attempt);

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        content: true,
        questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } },
      },
    });
    if (!quiz) throw notFound('Quiz');

    await LearningService.assertContentUnlocked(attempt, quiz.contentId);

    if (quiz.questions.length === 0) {
      throw unprocessable('This quiz has no questions yet.', 'INVALID_PROGRESS');
    }

    const previousCount = await prisma.quizAttempt.count({ where: { quizId, attemptId, userId } });
    if (quiz.maxAttempts !== null && previousCount >= quiz.maxAttempts) {
      throw unprocessable('You have used all available attempts for this quiz.', 'ATTEMPT_LIMIT_REACHED', {
        maxAttempts: quiz.maxAttempts,
        attemptsUsed: previousCount,
      });
    }

    const answers = normalizeAnswerMap(input.answers);
    const grade = gradeQuestions(
      quiz.questions.map((question) => ({
        id: question.id,
        type: question.type,
        points: question.points,
        options: question.options.map((option) => ({ id: option.id, isCorrect: option.isCorrect })),
      })),
      answers,
    );

    const passed = isPassing(grade, quiz.passingScore);

    const saved = await withTransaction(async (tx) => {
      const created = await tx.quizAttempt.create({
        data: {
          quizId,
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
          submittedAt: new Date(),
          gradedAt: grade.hasPendingReview ? null : new Date(),
        },
      });

      // A passing quiz completes its content item, which may unlock the next
      // item (e.g. the module assessment).
      if (passed) {
        const existing = await tx.contentProgress.findUnique({
          where: { attemptId_contentId: { attemptId, contentId: quiz.contentId } },
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
              contentId: quiz.contentId,
              userId,
              status: 'COMPLETED',
              completedAt: new Date(),
              firstAccessedAt: new Date(),
            },
          });
        }
      }

      return created;
    });

    const refreshed = await LearningService.loadAttempt(attemptId, userId);
    const sequence = LearningService.buildSequence(refreshed);

    // Answer key + explanations are revealed only after submitting.
    const review = quiz.questions.map((question, index) => {
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

    return {
      attempt: {
        id: saved.id,
        attemptNumber: saved.attemptNumber,
        score: saved.score,
        maxScore: saved.maxScore,
        percentage: saved.percentage,
        passed: saved.passed,
        status: saved.status,
        submittedAt: saved.submittedAt,
      },
      passingScore: quiz.passingScore,
      correctCount: grade.correctCount,
      totalQuestions: grade.totalQuestions,
      hasPendingReview: grade.hasPendingReview,
      review,
      progress: sequence.stats,
      unlocked: {
        nextContent: sequence.nextContent,
        finalAssessmentUnlocked: sequence.finalAssessment?.isUnlocked ?? false,
      },
    };
  },

  async getResults(quizId: string, attemptId: string, userId: string) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        content: true,
        questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
      },
    });
    if (!quiz) throw notFound('Quiz');

    const attempt = await LearningService.loadAttempt(attemptId, userId);
    void attempt;

    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId, attemptId, userId },
      orderBy: { attemptNumber: 'desc' },
    });

    const best = attempts.length
      ? attempts.reduce((bestAttempt, current) => (current.percentage > bestAttempt.percentage ? current : bestAttempt))
      : null;

    const latest = attempts[0];
    const answers = normalizeAnswerMap(latest?.answers);

    return {
      quiz: { id: quiz.id, title: quiz.title, passingScore: quiz.passingScore, maxAttempts: quiz.maxAttempts },
      attemptsUsed: attempts.length,
      attemptsRemaining: quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - attempts.length),
      best: best ? { attemptNumber: best.attemptNumber, percentage: best.percentage, passed: best.passed, submittedAt: best.submittedAt } : null,
      history: attempts.map((entry) => ({
        attemptNumber: entry.attemptNumber,
        score: entry.score,
        maxScore: entry.maxScore,
        percentage: entry.percentage,
        passed: entry.passed,
        status: entry.status,
        submittedAt: entry.submittedAt,
      })),
      review:
        latest === undefined
          ? null
          : quiz.questions.map((question) => ({
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

  /** Instructor-facing: manual grading hook for subjective questions. */
  async overrideAttemptScore(params: {
    quizAttemptId: string;
    actorId: string;
    role: string;
    score: number;
    notes?: string;
  }) {
    const quizAttempt = await prisma.quizAttempt.findUnique({
      where: { id: params.quizAttemptId },
      include: { quiz: { include: { content: { include: { module: { include: { course: true } } } } } } },
    });
    if (!quizAttempt) throw notFound('Quiz attempt');

    const course = quizAttempt.quiz.content.module.course;
    if (params.role !== 'ADMIN' && course.instructorId !== params.actorId) {
      throw forbidden('You can only grade submissions for your own courses.');
    }
    if (params.score < 0 || params.score > quizAttempt.maxScore) {
      throw badRequest(`Score must be between 0 and ${quizAttempt.maxScore}.`);
    }

    const percentage = quizAttempt.maxScore > 0 ? roundTo((params.score / quizAttempt.maxScore) * 100, 2) : 0;

    return prisma.quizAttempt.update({
      where: { id: params.quizAttemptId },
      data: {
        score: params.score,
        percentage,
        passed: percentage >= quizAttempt.quiz.passingScore,
        status: 'MANUALLY_GRADED',
        gradedAt: new Date(),
      },
    });
  },
};

