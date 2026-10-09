import { Router } from 'express';
import { authRouter } from './auth.routes';
import {
  assessmentAdminRouter,
  contentRouter,
  courseRouter,
  instructorPublicRouter,
  moduleRouter,
  quizAdminRouter,
} from './course.routes';
import { attemptRouter, contentAliasRouter, moduleAliasRouter, submissionReviewRouter } from './learning.routes';
import { enrollmentRouter } from './enrollment.routes';
import { rewardRouter, stakeRouter, walletRouter } from './wallet.routes';
import { dashboardRouter, instructorRouter, myCoursesRouter } from './analytics.routes';
import { adminRouter } from './admin.routes';
import { healthRouter, notificationRouter, reviewRouter } from './misc.routes';

/**
 * API surface. Mounted once at `API_PREFIX` (default `/api`).
 *
 * A quick map of the resource tree:
 *   /auth            registration, login, profile
 *   /courses         catalogue (public) + authoring (instructor/admin)
 *   /modules         curriculum authoring
 *   /content         curriculum authoring + learner progress aliases
 *   /quizzes         quiz question authoring
 *   /assessments     assessment question authoring, submission review
 *   /enrollments     learner enrolments, retry, withdrawal
 *   /attempts        sequential learning, quizzes, assessments, settlement
 *   /stakes          stake ledger
 *   /wallet          points wallet + transaction history
 *   /rewards         earned rewards + platform pool
 *   /dashboard       learner dashboard
 *   /my-courses      learner course list
 *   /instructor      instructor analytics
 *   /admin           platform administration
 *   /notifications   in-app notifications
 *   /reviews         learner reviews
 *   /health          liveness/readiness probe
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

apiRouter.use('/courses', courseRouter);
apiRouter.use('/modules', moduleRouter);
apiRouter.use('/modules', moduleAliasRouter);
apiRouter.use('/content', contentRouter);
apiRouter.use('/content', contentAliasRouter);
apiRouter.use('/quizzes', quizAdminRouter);
apiRouter.use('/assessments', assessmentAdminRouter);
apiRouter.use('/submissions', submissionReviewRouter);

apiRouter.use('/enrollments', enrollmentRouter);
apiRouter.use('/attempts', attemptRouter);

apiRouter.use('/stakes', stakeRouter);
apiRouter.use('/wallet', walletRouter);
apiRouter.use('/rewards', rewardRouter);

apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/my-courses', myCoursesRouter);
apiRouter.use('/instructor', instructorRouter);
apiRouter.use('/admin', adminRouter);

apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/reviews', reviewRouter);
apiRouter.use('/instructors', instructorPublicRouter);
