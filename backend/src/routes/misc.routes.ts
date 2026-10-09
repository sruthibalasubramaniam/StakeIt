import { Router } from 'express';
import { HealthController, NotificationController, ReviewController } from '../controllers/misc.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAuth, requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { notificationParam, notificationQuery, reviewSchema, uuidParam } from '../validators/schemas';

/** `/api/health` — used by docker-compose and uptime checks. */
export const healthRouter = Router();
healthRouter.get('/', HealthController.check);

export const notificationRouter = Router();
notificationRouter.use(authenticate, requireAuth());
notificationRouter.get('/', validate({ query: notificationQuery }), NotificationController.list);
notificationRouter.get('/unread-count', NotificationController.unreadCount);
notificationRouter.post('/read-all', NotificationController.markAllRead);
notificationRouter.post('/:id/read', validate({ params: notificationParam }), NotificationController.markRead);

export const reviewRouter = Router();
reviewRouter.use(authenticate, requireAuth());
reviewRouter.get('/mine', requireRole('LEARNER'), ReviewController.mine);
reviewRouter.patch(
  '/:id',
  requireRole('LEARNER'),
  validate({ params: uuidParam, body: reviewSchema.partial() }),
  ReviewController.update,
);
