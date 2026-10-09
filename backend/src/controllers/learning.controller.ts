import type { Request, Response } from 'express';
import { LearningService } from '../services/learningService';
import { QuizService } from '../services/quizService';
import { AssessmentService } from '../services/assessmentService';
import { CompletionService } from '../services/completionService';
import { DeadlineService } from '../services/deadlineService';
import { EnrollmentService } from '../services/enrollmentService';
import { badRequest } from '../lib/errors';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

/**
 * Attempt id resolution.
 *
 * Learning routes are attempt-scoped. The canonical form carries the attempt in
 * the path (`/api/attempts/:attemptId/...`), while the spec-style aliases
 * (`/api/content/:contentId?attemptId=...`) carry it in the query — both
 * resolve here so every handler has exactly one source of truth.
 */
function resolveAttemptId(req: Request): string {
  const fromParams = req.params.attemptId;
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams;
  const fromQuery = req.query.attemptId;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  throw badRequest('An attemptId is required (path parameter or ?attemptId= query).');
}

export const LearningController = {
  /**
   * Full learning state for an enrolment (module tree, locks, deadlines, stake).
   * Mounted as `GET /api/enrollments/:id/learning-state`, so the enrolment id is
   * read from `:id` — the same convention every other route on that router uses.
   */
  state: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const entry = await EnrollmentService.getLearningEntry(req.params.id as string, userId);
    const state = await LearningService.getLearningState(entry.attemptId, userId);
    res.status(200).json({ data: { ...state, entry } });
  }),

  /**
   * A single module of an attempt. Mounted as
   * `GET /api/modules/:moduleId?attemptId=...`; `getModule` is attempt-scoped, so
   * the attempt is resolved directly rather than via an enrolment lookup.
   */
  module: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await LearningService.getModule(resolveAttemptId(req), req.params.moduleId as string, userId);
    res.status(200).json({ data: result });
  }),

  content: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await LearningService.getContent(
      resolveAttemptId(req),
      req.params.contentId as string,
      userId,
    );
    res.status(200).json({ data: result });
  }),

  recordProgress: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const attemptId = resolveAttemptId(req);
    const contentId = req.params.contentId as string;

    // The same endpoint serves video heartbeats and reading scroll updates.
    if (req.body.positionSeconds !== undefined || req.body.durationSeconds !== undefined) {
      const result = await LearningService.recordVideoProgress(attemptId, contentId, userId, req.body);
      res.status(200).json({ data: result });
      return;
    }

    const result = await LearningService.recordReadingProgress(attemptId, contentId, userId, req.body);
    res.status(200).json({ data: result });
  }),

  comprehension: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await LearningService.submitComprehension(
      resolveAttemptId(req),
      req.params.contentId as string,
      userId,
      req.body.answer,
    );
    res.status(200).json({ data: result });
  }),

  complete: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await LearningService.completeContent(
      resolveAttemptId(req),
      req.params.contentId as string,
      userId,
    );
    res.status(200).json({ data: result });
  }),

  pacing: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await DeadlineService.getPacing(resolveAttemptId(req), userId);
    res.status(200).json({ data: result });
  }),

  settlementPreview: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await CompletionService.previewSettlement(resolveAttemptId(req), userId);
    res.status(200).json({ data: result });
  }),

  settlement: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await CompletionService.getSettlement(resolveAttemptId(req), userId);
    res.status(200).json({ data: result });
  }),
};

export const QuizController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await QuizService.getQuiz(req.params.quizId as string, resolveAttemptId(req), userId);
    res.status(200).json({ data: result });
  }),

  attempt: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await QuizService.submitQuiz(req.params.quizId as string, resolveAttemptId(req), userId, {
      answers: req.body.answers,
      timeSpentSeconds: req.body.timeSpentSeconds,
    });
    res.status(201).json({ data: result });
  }),

  results: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await QuizService.getResults(req.params.quizId as string, resolveAttemptId(req), userId);
    res.status(200).json({ data: result });
  }),
};

export const AssessmentController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AssessmentService.getAssessment(
      req.params.assessmentId as string,
      resolveAttemptId(req),
      userId,
    );
    res.status(200).json({ data: result });
  }),

  submit: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AssessmentService.submitAssessment(
      req.params.assessmentId as string,
      resolveAttemptId(req),
      userId,
      { answers: req.body.answers, timeSpentSeconds: req.body.timeSpentSeconds },
    );
    res.status(201).json({ data: result });
  }),

  results: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AssessmentService.getResults(
      req.params.assessmentId as string,
      resolveAttemptId(req),
      userId,
    );
    res.status(200).json({ data: result });
  }),

  manualReview: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await AssessmentService.manualReview({
      submissionId: req.params.submissionId as string,
      actorId: userId,
      role,
      score: req.body.score,
      notes: req.body.notes,
      passed: req.body.passed,
    });
    res.status(200).json({ data: result });
  }),
};

