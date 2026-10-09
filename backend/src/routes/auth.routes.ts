import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAuth } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimit';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../validators/schemas';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), AuthController.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), AuthController.login);
authRouter.post('/logout', authenticate, AuthController.logout);

// The spec exposes `POST /api/auth/profile`; both verbs are supported so
// clients can send either form of the update.
authRouter.post('/profile', authenticate, requireAuth(), validate({ body: updateProfileSchema }), AuthController.updateProfile);
authRouter.get('/profile', authenticate, requireAuth(), AuthController.profile);
authRouter.put('/profile', authenticate, requireAuth(), validate({ body: updateProfileSchema }), AuthController.updateProfile);
authRouter.patch('/profile', authenticate, requireAuth(), validate({ body: updateProfileSchema }), AuthController.updateProfile);

authRouter.post(
  '/change-password',
  authenticate,
  requireAuth(),
  authLimiter,
  validate({ body: changePasswordSchema }),
  AuthController.changePassword,
);
