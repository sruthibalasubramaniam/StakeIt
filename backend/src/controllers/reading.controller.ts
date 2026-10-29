import type { Request, Response } from 'express';
import { ReadingService } from '../services/readingService';
import { ReadingProgressService } from '../services/readingProgressService';
import { AiReadingService } from '../services/aiReadingService';
import { ReadingImportService } from '../services/readingImportService';
import { badRequest } from '../lib/errors';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

/** Attempt id resolution, identical to the learning controller. */
function resolveAttemptId(req: Request): string {
  const fromParams = req.params.attemptId;
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams;
  const fromQuery = req.query.attemptId;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  throw badRequest('An attemptId is required (path parameter or ?attemptId= query).');
}

/**
 * Instructor / admin authoring for structured reading lessons.
 *
 * Every handler delegates ownership (`CourseService.assertInstructorOwnsCourse`)
 * and content-type checks to the service, so a route can never be the only thing
 * standing between an instructor and another instructor's course.
 */
export const ReadingController = {
  /** Full draft (sections, checkpoints with answer keys, resources). */
  view: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.authoringView(req.params.contentId as string, userId, role);
    res.status(200).json({ data: result });
  }),

  updateLesson: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.updateLesson(req.params.contentId as string, userId, role, req.body);
    res.status(200).json({ data: result });
  }),

  createSection: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.createSection(req.params.contentId as string, userId, role, req.body);
    res.status(201).json({ data: result });
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.updateSection(
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
      role,
      req.body,
    );
    res.status(200).json({ data: result });
  }),

  deleteSection: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.deleteSection(
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
      role,
    );
    res.status(200).json({ data: result });
  }),

  reorderSections: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.reorderSections(
      req.params.contentId as string,
      userId,
      role,
      req.body.orderedIds,
    );
    res.status(200).json({ data: result });
  }),

  upsertCheckpoint: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.upsertCheckpoint(
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
      role,
      req.body,
    );
    res.status(200).json({ data: result });
  }),

  deleteCheckpoint: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.deleteCheckpoint(
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
      role,
    );
    res.status(200).json({ data: result });
  }),

  /** Import a document into draft sections, optionally with AI knowledge checks. */
  importDocument: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length === 0) {
      throw badRequest('No file was received. Send the raw file with an x-file-name header.');
    }

    const result = await ReadingImportService.importDocument(
      req.params.contentId as string,
      userId,
      role,
      {
        buffer,
        fileName: String(req.headers['x-file-name'] ?? 'document.pdf'),
        mimeType: String(req.headers['content-type'] ?? 'application/octet-stream'),
        generateCheckpoints: String(req.headers['x-ai-checkpoints'] ?? 'true') === 'true',
      },
    );

    res.status(201).json({ data: result });
  }),

  publish: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.publish(req.params.contentId as string, userId, role);
    res.status(200).json({ data: result });
  }),

  unpublish: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.unpublish(req.params.contentId as string, userId, role);
    res.status(200).json({ data: result });
  }),

  preview: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.preview(req.params.contentId as string, userId, role);
    res.status(200).json({ data: result });
  }),

  addLinkResource: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.addLinkResource(req.params.contentId as string, userId, role, req.body);
    res.status(201).json({ data: result });
  }),

  /**
   * Raw PDF upload.
   *
   * The body is `application/pdf` bytes (parsed by a route-scoped
   * `express.raw`), with the display name in `x-file-name`. Multipart is
   * deliberately avoided: no extra dependency, and the size limit can be
   * enforced by the body parser and the service.
   */
  uploadPdf: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const body = Buffer.isBuffer(req.body) ? req.body : undefined;
    const fileName = typeof req.headers['x-file-name'] === 'string' ? decodeURIComponent(req.headers['x-file-name']) : undefined;
    const title = typeof req.headers['x-resource-title'] === 'string' ? decodeURIComponent(req.headers['x-resource-title']) : undefined;

    const result = await ReadingService.uploadPdfResource(req.params.contentId as string, userId, role, {
      body,
      contentType: req.headers['content-type'],
      fileName,
      title,
    });
    res.status(201).json({ data: result });
  }),

  deleteResource: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.deleteResource(
      req.params.contentId as string,
      req.params.resourceId as string,
      userId,
      role,
    );
    res.status(200).json({ data: result });
  }),

  resourceUrl: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await ReadingService.resourceUrlForAuthoring(
      req.params.contentId as string,
      req.params.resourceId as string,
      userId,
      role,
    );
    res.status(200).json({ data: result });
  }),

};

/* -------------------------------------------------------------------------- */
/* AI helpers (instructor)                                                     */
/* -------------------------------------------------------------------------- */

export const ReadingAiController = {
  status: asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ data: AiReadingService.status() });
  }),

  draftQuestions: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const body = (req.body ?? {}) as { count?: number };
    const result = await AiReadingService.draftQuestions(
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
      role,
      body.count ?? 2,
    );
    res.status(200).json({ data: result });
  }),
};
/**
 * Learner-facing reading endpoints. Every call re-loads the attempt and
 * re-applies the ownership, deadline and sequential-unlock guards.
 */
export const ReadingLearnerController = {
  savePosition: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await ReadingProgressService.savePosition(
      resolveAttemptId(req),
      req.params.contentId as string,
      userId,
      req.body,
    );
    res.status(200).json({ data: result });
  }),

  markSectionRead: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await ReadingProgressService.markSectionRead(
      resolveAttemptId(req),
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
      Number(req.body?.activeSeconds ?? 0),
    );
    res.status(200).json({ data: result });
  }),

  submitCheckpoint: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await ReadingProgressService.submitCheckpoint(
      resolveAttemptId(req),
      req.params.contentId as string,
      req.params.checkpointId as string,
      userId,
      req.body.answers,
    );
    res.status(201).json({ data: result });
  }),

  resourceUrl: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await ReadingProgressService.resourceUrl(
      resolveAttemptId(req),
      req.params.contentId as string,
      req.params.resourceId as string,
      userId,
    );
    res.status(200).json({ data: result });
  }),

  /** Optional study aid: summarise the section the learner is currently reading. */
  sectionSummary: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AiReadingService.summariseSection(
      resolveAttemptId(req),
      req.params.contentId as string,
      req.params.sectionId as string,
      userId,
    );
    res.status(200).json({ data: result });
  }),
};
