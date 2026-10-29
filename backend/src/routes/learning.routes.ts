import { Router } from 'express';
import { z } from 'zod';
import { AssessmentController, LearningController, QuizController } from '../controllers/learning.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { progressLimiter } from '../middleware/rateLimit';
import {
  comprehensionSchema,
  readingProgressSchema,
  submissionSchema,
  uuidParam,
  videoProgressSchema,
} from '../validators/schemas';
import { registerLearnerReadingRoutes } from './reading.routes';
import { registerLearnerCertificateRoutes } from './certificate.routes';

/**
 * Learning endpoints are scoped to a course attempt (`/api/attempts/:attemptId/...`)
 * because progress, quiz attempts and submissions all belong to one attempt.
 * Spec-style aliases (`/api/modules/:id`, `/api/content/:id`) are registered at
 * the bottom and resolve the attempt from the `attemptId` query parameter.
 */
export const attemptRouter = Router();

attemptRouter.use(authenticate, requireRole('LEARNER'));

const attemptParams = { attemptId: uuidParam };

attemptRouter.get(
  '/:attemptId/modules/:moduleId',
  validate({ params: { ...attemptParams, moduleId: uuidParam } }),
  LearningController.module,
);

attemptRouter.get(
  '/:attemptId/content/:contentId',
  validate({ params: { ...attemptParams, contentId: uuidParam } }),
  LearningController.content,
);
attemptRouter.post(
  '/:attemptId/content/:contentId/progress',
  progressLimiter,
  validate({ params: { ...attemptParams, contentId: uuidParam }, body: videoProgressSchema.partial().merge(readingProgressSchema.partial()) }),
  LearningController.recordProgress,
);
attemptRouter.post(
  '/:attemptId/content/:contentId/comprehension',
  validate({ params: { ...attemptParams, contentId: uuidParam }, body: comprehensionSchema }),
  LearningController.comprehension,
);
attemptRouter.post(
  '/:attemptId/content/:contentId/complete',
  validate({ params: { ...attemptParams, contentId: uuidParam } }),
  LearningController.complete,
);

/* --------------------- Structured reading lessons ------------------------ */
/*
 * Position, section completion and checkpoint submission for the MOOC reader.
 * Registered on the attempt router so every call inherits the same
 * learner-role + ownership guarantees as the rest of `/attempts`.
 */
registerLearnerReadingRoutes(attemptRouter);
registerLearnerCertificateRoutes(attemptRouter);

attemptRouter.get('/:attemptId/pacing', validate({ params: attemptParams }), LearningController.pacing);
attemptRouter.get('/:attemptId/settlement', validate({ params: attemptParams }), LearningController.settlement);
attemptRouter.get(
  '/:attemptId/settlement/preview',
  validate({ params: attemptParams }),
  LearningController.settlementPreview,
);

/* ------------------------------- Quizzes --------------------------------- */

attemptRouter.get(
  '/:attemptId/quizzes/:quizId',
  validate({ params: { ...attemptParams, quizId: uuidParam } }),
  QuizController.get,
);
attemptRouter.post(
  '/:attemptId/quizzes/:quizId/attempt',
  validate({ params: { ...attemptParams, quizId: uuidParam }, body: submissionSchema }),
  QuizController.attempt,
);
attemptRouter.get(
  '/:attemptId/quizzes/:quizId/results',
  validate({ params: { ...attemptParams, quizId: uuidParam } }),
  QuizController.results,
);

/* ----------------------------- Assessments ------------------------------- */

attemptRouter.get(
  '/:attemptId/assessments/:assessmentId',
  validate({ params: { ...attemptParams, assessmentId: uuidParam } }),
  AssessmentController.get,
);
attemptRouter.post(
  '/:attemptId/assessments/:assessmentId/submit',
  validate({ params: { ...attemptParams, assessmentId: uuidParam }, body: submissionSchema }),
  AssessmentController.submit,
);
attemptRouter.get(
  '/:attemptId/assessments/:assessmentId/results',
  validate({ params: { ...attemptParams, assessmentId: uuidParam } }),
  AssessmentController.results,
);

/* -------------------------------------------------------------------------- */
/* Spec-alias routes: /api/modules/:id and /api/content/:id                    */
/* -------------------------------------------------------------------------- */

const attemptQuery = z.object({ attemptId: uuidParam });
const aliasGuards = [authenticate, requireRole('LEARNER')] as const;

/** `GET /api/modules/:moduleId?attemptId=...` */
export const moduleAliasRouter = Router();
moduleAliasRouter.get(
  '/:moduleId',
  ...aliasGuards,
  validate({ params: { moduleId: uuidParam }, query: attemptQuery }),
  LearningController.module,
);

/** `/api/content/:contentId?attemptId=...` and its progress/complete actions. */
export const contentAliasRouter = Router();
contentAliasRouter.get(
  '/:contentId',
  ...aliasGuards,
  validate({ params: { contentId: uuidParam }, query: attemptQuery }),
  LearningController.content,
);
contentAliasRouter.post(
  '/:contentId/progress',
  ...aliasGuards,
  progressLimiter,
  validate({
    params: { contentId: uuidParam },
    query: attemptQuery,
    body: videoProgressSchema.partial().merge(readingProgressSchema.partial()),
  }),
  LearningController.recordProgress,
);
contentAliasRouter.post(
  '/:contentId/comprehension',
  ...aliasGuards,
  validate({ params: { contentId: uuidParam }, query: attemptQuery, body: comprehensionSchema }),
  LearningController.comprehension,
);
contentAliasRouter.post(
  '/:contentId/complete',
  ...aliasGuards,
  validate({ params: { contentId: uuidParam }, query: attemptQuery }),
  LearningController.complete,
);

export const submissionReviewRouter = Router();
submissionReviewRouter.post(
  '/:submissionId/review',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({
    params: { submissionId: uuidParam },
    body: z.object({
      score: z.coerce.number().min(0),
      notes: z.string().max(2000).optional(),
      passed: z.boolean().optional(),
    }),
  }),
  AssessmentController.manualReview,
);
