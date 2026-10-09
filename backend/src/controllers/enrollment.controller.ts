import type { Request, Response } from 'express';
import { EnrollmentService } from '../services/enrollmentService';
import { StakeService } from '../services/stakeService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const EnrollmentController = {
  enroll: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await EnrollmentService.enroll(req.params.id as string, userId, {
      commitmentOptionId: req.body.commitmentOptionId ?? null,
      accelerated: req.body.accelerated ?? false,
    });
    res.status(201).json({ data: result });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await EnrollmentService.listEnrollments(userId, req.query as never);
    res.status(200).json({ data: result });
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await EnrollmentService.getLearningEntry(req.params.id as string, userId);
    res.status(200).json({ data: result });
  }),

  retry: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await EnrollmentService.retry(req.params.id as string, userId, {
      commitmentOptionId: req.body.commitmentOptionId ?? null,
      accelerated: req.body.accelerated ?? false,
    });
    res.status(201).json({ data: result });
  }),

  withdraw: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await EnrollmentService.withdraw(req.params.id as string, userId);
    res.status(200).json({ data: result });
  }),

  /** Stakes attached to an enrolment (used by /stakes and course detail). */
  stakes: asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = authContext(req);
    const enrollment = await EnrollmentService.getAttemptForLearner(req.params.id as string, userId);
    void enrollment;
    const result = await StakeService.listStakes(userId, { pageSize: 50 });
    void role;
    res.status(200).json({ data: result });
  }),
};
