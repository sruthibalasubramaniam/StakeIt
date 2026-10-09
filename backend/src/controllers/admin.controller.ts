import type { Request, Response } from 'express';
import { AdminService } from '../services/adminService';
import { DeadlineService } from '../services/deadlineService';
import { ReputationService } from '../services/reputationService';
import { RewardPoolService } from '../services/rewardPoolService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const AdminController = {
  /* ---------------- Users ------------------------------------------------ */

  listUsers: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.listUsers(req.query as never);
    res.status(200).json({ data: result });
  }),

  getUser: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.getUser(req.params.id as string);
    res.status(200).json({ data: result });
  }),

  updateUser: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.updateUser(req.params.id as string, userId, req.body);
    res.status(200).json({ data: result });
  }),

  deleteUser: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.deleteUser(req.params.id as string, userId);
    res.status(200).json({ data: result });
  }),

  grantPoints: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.grantPoints({
      userId: req.params.id as string,
      amount: req.body.amount,
      reason: req.body.reason,
      actorId: userId,
    });
    res.status(200).json({ data: result });
  }),

  /* ---------------- Courses & instructors -------------------------------- */

  listCourses: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.listCourses(req.query as never);
    res.status(200).json({ data: result });
  }),

  listInstructors: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.listInstructors(req.query as never);
    res.status(200).json({ data: result });
  }),

  /* ---------------- Moderation ------------------------------------------- */

  listReviews: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.listReviews(req.query as never);
    res.status(200).json({ data: result });
  }),

  moderateReview: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.moderateReview(req.params.id as string, req.body);
    res.status(200).json({ data: result });
  }),

  /* ---------------- Reward pool ------------------------------------------ */

  rewardPool: asyncHandler(async (req: Request, res: Response) => {
    const [pool, transactions] = await Promise.all([
      RewardPoolService.getPool(),
      RewardPoolService.listTransactions(req.query as never),
    ]);
    res.status(200).json({ data: { pool, transactions } });
  }),

  adjustRewardPool: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.adjustRewardPool(req.body.amount, req.body.reason, userId);
    res.status(200).json({ data: result });
  }),

  /* ---------------- Badges ----------------------------------------------- */

  listBadges: asyncHandler(async (req: Request, res: Response) => {
    const result = await ReputationService.listBadges(req.query as never);
    res.status(200).json({ data: result });
  }),

  awardBadge: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.awardBadge({
      instructorId: req.params.instructorId as string,
      tier: req.body.tier,
      actorId: userId,
      notes: req.body.notes,
    });
    res.status(200).json({ data: result });
  }),

  recomputeReputation: asyncHandler(async (_req: Request, res: Response) => {
    const result = await AdminService.recomputeReputation();
    res.status(200).json({ data: result });
  }),

  /* ---------------- Exceptional cases ------------------------------------ */

  extendDeadline: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.extendDeadline(
      req.params.attemptId as string,
      req.body.days,
      req.body.reason,
      userId,
    );
    res.status(200).json({ data: result });
  }),

  settleAttempt: asyncHandler(async (req: Request, res: Response) => {
    const result = await AdminService.settleAttemptNow(req.params.attemptId as string);
    res.status(200).json({ data: result });
  }),

  releaseStakes: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await AdminService.releaseStakes(req.params.attemptId as string, req.body.reason, userId);
    res.status(200).json({ data: result });
  }),

  /** On-demand trigger for the scheduled deadline engine. */
  runDeadlineEngine: asyncHandler(async (_req: Request, res: Response) => {
    const [atRisk, expired, reminders] = await Promise.all([
      DeadlineService.scanAtRisk(),
      DeadlineService.processExpiredAttempts(),
      DeadlineService.sendDeadlineReminders(),
    ]);
    res.status(200).json({ data: { atRisk, expired, reminders } });
  }),
};
