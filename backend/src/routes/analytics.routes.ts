import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { EnrollmentController } from '../controllers/enrollment.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { analyticsQuery, stakeListQuery } from '../validators/schemas';

/** Learner-facing analytics: `/api/dashboard`, `/api/my-courses`. */
export const dashboardRouter = Router();
dashboardRouter.use(authenticate, requireRole('LEARNER'));
dashboardRouter.get('/', AnalyticsController.learnerDashboard);

export const myCoursesRouter = Router();
myCoursesRouter.use(authenticate, requireRole('LEARNER'));
myCoursesRouter.get('/', validate({ query: stakeListQuery.partial() }), EnrollmentController.list);

/** Instructor analytics namespace: `/api/instructor/*`. */
export const instructorRouter = Router();
instructorRouter.use(authenticate, requireRole('INSTRUCTOR', 'ADMIN'));
instructorRouter.get('/dashboard', AnalyticsController.instructorDashboard);
instructorRouter.get('/analytics', AnalyticsController.instructorDashboard);
instructorRouter.get('/courses', AnalyticsController.instructorCourses);
instructorRouter.get('/reviews', validate({ query: analyticsQuery }), AnalyticsController.instructorDashboard);
