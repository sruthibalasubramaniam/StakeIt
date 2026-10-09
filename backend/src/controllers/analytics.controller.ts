import type { Request, Response } from 'express';
import { AnalyticsService } from '../services/analyticsService';
import { CourseService } from '../services/courseService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const AnalyticsController = {
  learnerDashboard: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AnalyticsService.learnerDashboard(userId);
    res.status(200).json({ data: result });
  }),

  instructorDashboard: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AnalyticsService.instructorDashboard(userId);
    res.status(200).json({ data: result });
  }),

  instructorCourses: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await CourseService.listInstructorCourses(userId);
    res.status(200).json({ data: result });
  }),

  courseAnalytics: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const result = await AnalyticsService.courseAnalytics(req.params.id as string, userId, role);
    res.status(200).json({ data: result });
  }),

  adminDashboard: asyncHandler(async (_req: Request, res: Response) => {
    const result = await AnalyticsService.adminDashboard();
    res.status(200).json({ data: result });
  }),

  platformTransactions: asyncHandler(async (req: Request, res: Response) => {
    const result = await AnalyticsService.platformTransactions(req.query as never);
    res.status(200).json({ data: result });
  }),
};
