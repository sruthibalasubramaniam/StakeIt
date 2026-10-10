import { Router } from 'express';
import {
  AssessmentAdminController,
  ContentController,
  CourseController,
  ModuleController,
  QuizAdminController,
} from '../controllers/course.controller';
import { CatalogueController, ProfileController, ReviewController } from '../controllers/misc.controller';
import { EnrollmentController } from '../controllers/enrollment.controller';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate';
import { requireAuth, requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { uuidParam, idParam, courseRefParam } from '../validators/schemas';
import {
  commitmentOptionsSchema,
  contentSchema,
  courseListQuery,
  createCourseSchema,
  enrollSchema,
  finalAssessmentSchema,
  questionsSchema,
  quizSettingsSchema,
  reorderSchema,
  reviewSchema,
  updateContentSchema,
  updateCourseSchema,
  moduleSchema,
} from '../validators/schemas';

export const courseRouter = Router();

/* ----------------------------- Public catalogue --------------------------- */

// NOTE: static segments must be declared before `/:id` so they are not shadowed.
courseRouter.get('/', optionalAuthenticate, validate({ query: courseListQuery }), CatalogueController.browse);
courseRouter.get('/facets', CourseController.facets);

// Addressed as `/courses/:idOrSlug` by the client — UUID, slug or course code.
courseRouter.get('/:id', optionalAuthenticate, validate({ params: courseRefParam }), CourseController.detail);

courseRouter.get(
  '/:id/recommendation',
  authenticate,
  requireRole('LEARNER'),
  validate({ params: idParam }),
  CourseController.recommend,
);

courseRouter.get('/:id/reviews', validate({ params: courseRefParam }), ReviewController.listForCourse);
courseRouter.post(
  '/:id/reviews',
  authenticate,
  requireRole('LEARNER'),
  validate({ params: idParam, body: reviewSchema }),
  ReviewController.create,
);

/* ------------------------------ Authoring (instructor/admin) ------------- */

courseRouter.post(
  '/',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ body: createCourseSchema }),
  CourseController.create,
);
courseRouter.put(
  '/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam, body: updateCourseSchema }),
  CourseController.update,
);
courseRouter.delete(
  '/:id',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  CourseController.remove,
);
courseRouter.post(
  '/:id/publish',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  CourseController.publish,
);
courseRouter.post(
  '/:id/unpublish',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  CourseController.unpublish,
);
courseRouter.post(
  '/:id/archive',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  CourseController.archive,
);
courseRouter.get(
  '/:id/preview',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  CourseController.preview,
);

/* ------------------------------ Curriculum -------------------------------- */

courseRouter.get(
  '/:id/modules',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  CourseController.listModules,
);
courseRouter.post(
  '/:id/modules',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam, body: moduleSchema }),
  CourseController.createModule,
);
courseRouter.patch(
  '/:id/modules/reorder',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam, body: reorderSchema }),
  CourseController.reorderModules,
);
courseRouter.put(
  '/:id/commitment-options',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam, body: commitmentOptionsSchema }),
  CourseController.replaceCommitmentOptions,
);
courseRouter.post(
  '/:id/final-assessment',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam, body: finalAssessmentSchema }),
  CourseController.upsertFinalAssessment,
);

/* ------------------------------ Enrolment --------------------------------- */

courseRouter.post(
  '/:id/enroll',
  authenticate,
  requireRole('LEARNER'),
  validate({ params: idParam, body: enrollSchema }),
  EnrollmentController.enroll,
);

/* ------------------------------ Analytics --------------------------------- */

courseRouter.get(
  '/:id/analytics',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: idParam }),
  AnalyticsController.courseAnalytics,
);

/* ------------------------------------------------------------------------- */
/* Module / content level authoring (mounted at /api/modules, /api/content)   */
/* ------------------------------------------------------------------------- */

export const moduleRouter = Router();

const moduleParam = { moduleId: uuidParam };

moduleRouter.put(
  '/:moduleId',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: moduleParam, body: moduleSchema.partial() }),
  ModuleController.update,
);
moduleRouter.delete(
  '/:moduleId',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: moduleParam }),
  ModuleController.remove,
);
moduleRouter.post(
  '/:moduleId/content',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: moduleParam, body: contentSchema }),
  ModuleController.createContent,
);
moduleRouter.patch(
  '/:moduleId/content/reorder',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: moduleParam, body: reorderSchema }),
  ModuleController.reorderContent,
);

export const contentRouter = Router();

contentRouter.put(
  '/:contentId',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: { contentId: uuidParam }, body: updateContentSchema }),
  ContentController.update,
);
contentRouter.delete(
  '/:contentId',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: { contentId: uuidParam } }),
  ContentController.remove,
);

export const quizAdminRouter = Router();
quizAdminRouter.put(
  '/:quizId/questions',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: { quizId: uuidParam }, body: questionsSchema }),
  QuizAdminController.replaceQuestions,
);
quizAdminRouter.patch(
  '/:quizId/settings',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: { quizId: uuidParam }, body: quizSettingsSchema }),
  QuizAdminController.updateSettings,
);

export const instructorPublicRouter = Router();
instructorPublicRouter.get('/:id', validate({ params: idParam }), ProfileController.instructor);

export const assessmentAdminRouter = Router();
assessmentAdminRouter.put(
  '/:assessmentId/questions',
  authenticate,
  requireRole('INSTRUCTOR', 'ADMIN'),
  validate({ params: { assessmentId: uuidParam }, body: questionsSchema }),
  AssessmentAdminController.replaceQuestions,
);
