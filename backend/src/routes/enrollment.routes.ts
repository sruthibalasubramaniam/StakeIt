import { Router } from 'express';
import { EnrollmentController } from '../controllers/enrollment.controller';
import { LearningController } from '../controllers/learning.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { enrollSchema, idParam } from '../validators/schemas';

export const enrollmentRouter = Router();

enrollmentRouter.use(authenticate);

enrollmentRouter.get('/', requireRole('LEARNER'), EnrollmentController.list);
enrollmentRouter.get('/:id', requireRole('LEARNER'), validate({ params: idParam }), EnrollmentController.detail);
enrollmentRouter.get(
  '/:id/learning-state',
  requireRole('LEARNER'),
  validate({ params: idParam }),
  LearningController.state,
);
enrollmentRouter.post(
  '/:id/retry',
  requireRole('LEARNER'),
  validate({ params: idParam, body: enrollSchema }),
  EnrollmentController.retry,
);
enrollmentRouter.post(
  '/:id/withdraw',
  requireRole('LEARNER'),
  validate({ params: idParam }),
  EnrollmentController.withdraw,
);
