import express, { Router } from 'express';
import { z } from 'zod';
import { ReadingAiController, ReadingController, ReadingLearnerController } from '../controllers/reading.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { aiLimiter, progressLimiter, uploadLimiter } from '../middleware/rateLimit';
import { env } from '../config/env';
import {
  readingCheckpointSchema,
  readingCheckpointSubmissionSchema,
  readingLessonMetaSchema,
  readingPositionSchema,
  readingResourceLinkSchema,
  readingSectionSchema,
  readingSectionUpdateSchema,
  reorderSchema,
  uuidParam,
} from '../validators/schemas';

const contentParam = { contentId: uuidParam };
const sectionParam = { ...contentParam, sectionId: uuidParam };
const resourceParam = { ...contentParam, resourceId: uuidParam };

/** AI question drafting takes only a count; everything else comes from the section. */
const readingDraftQuestionsSchema = z
  .object({ count: z.coerce.number().int().min(1).max(5).optional() })
  .strict();

/**
 * Reading-lesson authoring, mounted at `/api/content`.
 *
 * Path shape mirrors the rest of the curriculum API — everything hangs off the
 * content item the instructor already owns:
 *
 *   GET    /content/:contentId/reading                       full draft
 *   PUT    /content/:contentId/reading                       lesson metadata
 *   POST   /content/:contentId/reading/sections              add a section
 *   PUT    /content/:contentId/reading/sections/:sectionId    edit a section
 *   DELETE /content/:contentId/reading/sections/:sectionId    remove a section
 *   PATCH  /content/:contentId/reading/sections/reorder       reorder
 *   PUT    /content/:contentId/reading/sections/:sectionId/checkpoint
 *   DELETE /content/:contentId/reading/sections/:sectionId/checkpoint
 *   POST   /content/:contentId/reading/publish | /unpublish
 *   GET    /content/:contentId/reading/preview
 *   POST   /content/:contentId/reading/resources              attach a link/embed
 *   POST   /content/:contentId/reading/resources/upload       upload a PDF
 *   DELETE /content/:contentId/reading/resources/:resourceId
 *   GET    /content/:contentId/reading/resources/:resourceId/url
 */
export const readingAuthoringRouter = Router();

readingAuthoringRouter.use(authenticate, requireRole('INSTRUCTOR', 'ADMIN'));

readingAuthoringRouter.get(
  '/:contentId/reading',
  validate({ params: contentParam }),
  ReadingController.view,
);

readingAuthoringRouter.put(
  '/:contentId/reading',
  validate({ params: contentParam, body: readingLessonMetaSchema }),
  ReadingController.updateLesson,
);

readingAuthoringRouter.post(
  '/:contentId/reading/sections',
  validate({ params: contentParam, body: readingSectionSchema }),
  ReadingController.createSection,
);

readingAuthoringRouter.patch(
  '/:contentId/reading/sections/reorder',
  validate({ params: contentParam, body: reorderSchema }),
  ReadingController.reorderSections,
);

readingAuthoringRouter.put(
  '/:contentId/reading/sections/:sectionId',
  validate({ params: sectionParam, body: readingSectionUpdateSchema }),
  ReadingController.updateSection,
);

readingAuthoringRouter.delete(
  '/:contentId/reading/sections/:sectionId',
  validate({ params: sectionParam }),
  ReadingController.deleteSection,
);

readingAuthoringRouter.put(
  '/:contentId/reading/sections/:sectionId/checkpoint',
  validate({ params: sectionParam, body: readingCheckpointSchema }),
  ReadingController.upsertCheckpoint,
);

readingAuthoringRouter.delete(
  '/:contentId/reading/sections/:sectionId/checkpoint',
  validate({ params: sectionParam }),
  ReadingController.deleteCheckpoint,
);

readingAuthoringRouter.post(
  '/:contentId/reading/publish',
  validate({ params: contentParam }),
  ReadingController.publish,
);

readingAuthoringRouter.post(
  '/:contentId/reading/unpublish',
  validate({ params: contentParam }),
  ReadingController.unpublish,
);

readingAuthoringRouter.get(
  '/:contentId/reading/preview',
  validate({ params: contentParam }),
  ReadingController.preview,
);

readingAuthoringRouter.post(
  '/:contentId/reading/resources',
  validate({ params: contentParam, body: readingResourceLinkSchema }),
  ReadingController.addLinkResource,
);

/*
 * Raw PDF upload. The route-scoped `express.raw` parser runs before validation
 * so `req.body` is a Buffer; the limit is derived from the same env value the
 * service checks, plus a little headroom for the parser's own envelope.
 */
/*
 * Optional AI helpers. `aiLimiter` caps spend; a server without a configured
 * provider answers 503 AI_UNAVAILABLE and the editor hides the buttons.
 */
readingAuthoringRouter.get('/:contentId/reading/ai', validate({ params: contentParam }), ReadingAiController.status);

readingAuthoringRouter.post(
  '/:contentId/reading/sections/:sectionId/questions/draft',
  aiLimiter,
  validate({ params: sectionParam, body: readingDraftQuestionsSchema }),
  ReadingAiController.draftQuestions,
);

readingAuthoringRouter.post(
  '/:contentId/reading/resources/upload',
  uploadLimiter,
  express.raw({
    type: ['application/pdf', 'application/octet-stream'],
    limit: `${env.READING_PDF_MAX_MB + 2}mb`,
  }),
  validate({ params: contentParam }),
  ReadingController.uploadPdf,
);

/**
 * Document import: PDF, DOCX, Markdown, plain text.
 *
 * Raw body (like the PDF upload) because it avoids a multipart parser dependency.
 * `x-ai-checkpoints: false` skips the AI drafting pass when an instructor only
 * wants the structure.
 */
const IMPORT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
  'application/octet-stream',
];

readingAuthoringRouter.post(
  '/:contentId/reading/import',
  uploadLimiter,
  express.raw({
    type: IMPORT_MIME_TYPES,
    limit: `${Math.max(12, env.READING_PDF_MAX_MB + 6)}mb`,
  }),
  validate({ params: contentParam }),
  ReadingController.importDocument,
);

readingAuthoringRouter.delete(
  '/:contentId/reading/resources/:resourceId',
  validate({ params: resourceParam }),
  ReadingController.deleteResource,
);

readingAuthoringRouter.get(
  '/:contentId/reading/resources/:resourceId/url',
  validate({ params: resourceParam }),
  ReadingController.resourceUrl,
);

/**
 * Learner reading endpoints, mounted inside the attempt router:
 *
 *   POST /attempts/:attemptId/content/:contentId/reading/position
 *   POST /attempts/:attemptId/content/:contentId/reading/sections/:sectionId/complete
 *   POST /attempts/:attemptId/content/:contentId/reading/checkpoints/:checkpointId/submit
 *   GET  /attempts/:attemptId/content/:contentId/reading/resources/:resourceId/url
 */
export function registerLearnerReadingRoutes(router: Router): void {
  const attemptContentParam = { attemptId: uuidParam, contentId: uuidParam };

  router.post(
    '/:attemptId/content/:contentId/reading/position',
    progressLimiter,
    validate({ params: attemptContentParam, body: readingPositionSchema }),
    ReadingLearnerController.savePosition,
  );

  router.post(
    '/:attemptId/content/:contentId/reading/sections/:sectionId/complete',
    validate(
      {
        params: { ...attemptContentParam, sectionId: uuidParam },
        body: z.object({ activeSeconds: z.coerce.number().min(0).max(3600).optional() }).strict(),
      },
    ),
    ReadingLearnerController.markSectionRead,
  );

  router.post(
    '/:attemptId/content/:contentId/reading/checkpoints/:checkpointId/submit',
    progressLimiter,
    validate({
      params: { ...attemptContentParam, checkpointId: uuidParam },
      body: readingCheckpointSubmissionSchema,
    }),
    ReadingLearnerController.submitCheckpoint,
  );

  router.get(
    '/:attemptId/content/:contentId/reading/resources/:resourceId/url',
    validate({ params: { ...attemptContentParam, resourceId: uuidParam } }),
    ReadingLearnerController.resourceUrl,
  );

  // Optional study aid: only for sections the learner has already unlocked.
  router.post(
    '/:attemptId/content/:contentId/reading/sections/:sectionId/summary',
    aiLimiter,
    validate({ params: { ...attemptContentParam, sectionId: uuidParam } }),
    ReadingLearnerController.sectionSummary,
  );
}
