import { Router } from 'express';
import { z } from 'zod';
import { CertificateController } from '../controllers/certificate.controller';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { verifyLimiter } from '../middleware/rateLimit';

const attemptParam = { attemptId: z.string().uuid('A valid attempt id is required.') };
const codeParam = { code: z.string().trim().min(4).max(40) };

/**
 * Learner routes, registered on the attempt router so they inherit the same
 * authentication and ownership conventions as the rest of `/attempts`.
 */
export function registerLearnerCertificateRoutes(router: Router): void {
  router.get('/:attemptId/certificate', validate({ params: attemptParam }), CertificateController.forAttempt);
  router.post('/:attemptId/certificate', validate({ params: attemptParam }), CertificateController.issue);
  router.get('/:attemptId/certificate/file', validate({ params: attemptParam }), CertificateController.download);
}

/**
 * Mixed-auth router mounted at `/api/certificates`.
 *
 * `verify` is deliberately public — it is the point of a verification code — and
 * therefore rate limited so codes cannot be enumerated in bulk.
 */
export const certificateRouter = Router();

certificateRouter.get('/mine', authenticate, requireRole('LEARNER'), CertificateController.mine);

certificateRouter.get('/verify/:code', verifyLimiter, validate({ params: codeParam }), CertificateController.verify);

certificateRouter.post(
  '/:code/revoke',
  authenticate,
  requireRole('ADMIN'),
  validate({
    params: codeParam,
    body: z.object({ reason: z.string().trim().min(3, 'Give a reason for the revocation.').max(300) }).strict(),
  }),
  CertificateController.revoke,
);
