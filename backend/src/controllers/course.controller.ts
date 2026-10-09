import type { Request, Response } from 'express';
import { CourseService } from '../services/courseService';
import { CurriculumService } from '../services/curriculumService';
import { RecommendationService } from '../services/recommendationService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const CourseController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await CourseService.list(req.query as never, req.auth);
    res.status(200).json({ data: result });
  }),

  facets: asyncHandler(async (_req: Request, res: Response) => {
    const result = await CourseService.facets();
    res.status(200).json({ data: result });
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const result = await CourseService.getByIdOrSlug(req.params.id as string, req.auth);
    res.status(200).json({ data: result });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await CourseService.create(userId, req.body);
    res.status(201).json({ data: result });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CourseService.update(req.params.id as string, userId, role, req.body);
    res.status(200).json({ data: result });
  }),

  publish: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CourseService.publish(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),

  unpublish: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CourseService.unpublish(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),

  archive: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CourseService.archive(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CourseService.remove(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),

  recommend: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await RecommendationService.recommendForCourse(userId, req.params.id as string);
    res.status(200).json({ data: result });
  }),

  /* ---------------- Curriculum authoring (nested under a course) --------- */

  listModules: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    await CourseService.assertInstructorOwnsCourse(req.params.id as string, userId, role);
    const result = await CurriculumService.listModules(req.params.id as string);
    res.status(200).json({ data: result });
  }),

  createModule: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.createModule(req.params.id as string, userId, role, req.body);
    res.status(201).json({ data: result });
  }),

  reorderModules: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.reorderModules(
      req.params.id as string,
      userId,
      role,
      req.body.orderedIds,
    );
    res.status(200).json({ data: result });
  }),

  replaceCommitmentOptions: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.replaceCommitmentOptions(
      req.params.id as string,
      userId,
      role,
      req.body.options,
    );
    res.status(200).json({ data: result });
  }),

  upsertFinalAssessment: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.upsertFinalAssessment(req.params.id as string, userId, role, req.body);
    res.status(200).json({ data: result });
  }),

  preview: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.previewForInstructor(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),
};

export const ModuleController = {
  update: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.updateModule(req.params.moduleId as string, userId, role, req.body);
    res.status(200).json({ data: result });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.deleteModule(req.params.moduleId as string, userId, role);
    res.status(200).json({ data: result });
  }),

  createContent: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.createContent(req.params.moduleId as string, userId, role, req.body);
    res.status(201).json({ data: result });
  }),

  reorderContent: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.reorderContent(
      req.params.moduleId as string,
      userId,
      role,
      req.body.orderedIds,
    );
    res.status(200).json({ data: result });
  }),
};

export const ContentController = {
  update: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.updateContent(req.params.contentId as string, userId, role, req.body);
    res.status(200).json({ data: result });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.deleteContent(req.params.contentId as string, userId, role);
    res.status(200).json({ data: result });
  }),
};

export const QuizAdminController = {
  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.updateQuizSettings(req.params.quizId as string, userId, role, req.body);
    res.status(200).json({ data: result });
  }),

  replaceQuestions: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.replaceQuizQuestions(
      req.params.quizId as string,
      userId,
      role,
      req.body.questions,
    );
    res.status(200).json({ data: result });
  }),
};

export const AssessmentAdminController = {
  replaceQuestions: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await CurriculumService.replaceAssessmentQuestions(
      req.params.assessmentId as string,
      userId,
      role,
      req.body.questions,
    );
    res.status(200).json({ data: result });
  }),
};
