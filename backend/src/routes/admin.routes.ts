import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { uuidParam } from '../validators/schemas';
import {
  adminBadgeSchema,
  adminExtendDeadlineSchema,
  adminGrantPointsSchema,
  adminModerateReviewSchema,
  adminPoolAdjustSchema,
  adminReleaseStakesSchema,
  adminUpdateUserSchema,
  adminUserQuery,
  analyticsQuery,
} from '../validators/schemas';

export const adminRouter = Router();

// Every /api/admin route requires the ADMIN role, resolved from the database.
adminRouter.use(authenticate, requireRole('ADMIN'));

/* ------------------------------- Overview -------------------------------- */

adminRouter.get('/dashboard', AnalyticsController.adminDashboard);
adminRouter.get('/analytics', AnalyticsController.adminDashboard);
adminRouter.get('/transactions', validate({ query: analyticsQuery }), AnalyticsController.platformTransactions);

/* --------------------------------- Users --------------------------------- */

adminRouter.get('/users', validate({ query: adminUserQuery }), AdminController.listUsers);
adminRouter.get('/users/:id', validate({ params: uuidParam }), AdminController.getUser);
adminRouter.patch(
  '/users/:id',
  validate({ params: uuidParam, body: adminUpdateUserSchema }),
  AdminController.updateUser,
);
adminRouter.delete('/users/:id', validate({ params: uuidParam }), AdminController.deleteUser);
adminRouter.post(
  '/users/:id/points',
  validate({ params: uuidParam, body: adminGrantPointsSchema }),
  AdminController.grantPoints,
);

/* ------------------------------- Courses --------------------------------- */

adminRouter.get('/courses', AdminController.listCourses);
adminRouter.get('/instructors', AdminController.listInstructors);

/* ------------------------------ Moderation ------------------------------- */

adminRouter.get('/reviews', AdminController.listReviews);
adminRouter.patch(
  '/reviews/:id',
  validate({ params: uuidParam, body: adminModerateReviewSchema }),
  AdminController.moderateReview,
);

/* ------------------------------ Reward pool ------------------------------ */

adminRouter.get('/reward-pool', AdminController.rewardPool);
adminRouter.post(
  '/reward-pool/adjust',
  validate({ body: adminPoolAdjustSchema }),
  AdminController.adjustRewardPool,
);

/* -------------------------------- Badges --------------------------------- */

adminRouter.get('/badges', AdminController.listBadges);
adminRouter.post(
  '/instructors/:instructorId/badge',
  validate({ params: { instructorId: uuidParam }, body: adminBadgeSchema }),
  AdminController.awardBadge,
);
adminRouter.post('/reputation/recompute', AdminController.recomputeReputation);

/* --------------------------- Exceptional cases --------------------------- */

adminRouter.post(
  '/attempts/:attemptId/extend-deadline',
  validate({ params: { attemptId: uuidParam }, body: adminExtendDeadlineSchema }),
  AdminController.extendDeadline,
);
adminRouter.post(
  '/attempts/:attemptId/settle',
  validate({ params: { attemptId: uuidParam } }),
  AdminController.settleAttempt,
);
adminRouter.post(
  '/attempts/:attemptId/release-stakes',
  validate({ params: { attemptId: uuidParam }, body: adminReleaseStakesSchema }),
  AdminController.releaseStakes,
);

/* ------------------------- Deadline engine (manual) ---------------------- */

adminRouter.post('/deadline-engine/run', AdminController.runDeadlineEngine);
