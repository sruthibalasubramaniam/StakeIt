import type { Request, Response } from 'express';
import { CertificateService } from '../services/certificateService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const CertificateController = {
  /** Certificates of the signed-in learner. */
  mine: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    res.status(200).json({ data: await CertificateService.listForUser(userId) });
  }),

  forAttempt: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const certificate = await CertificateService.forAttempt(req.params.attemptId as string, userId);
    res.status(200).json({ data: { certificate } });
  }),

  issue: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const certificate = await CertificateService.issue(req.params.attemptId as string, userId);
    res.status(201).json({ data: { certificate } });
  }),

  download: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const { bytes, filename } = await CertificateService.pdf(req.params.attemptId as string, userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).send(Buffer.from(bytes));
  }),

  /** Public: no auth, so it returns a redacted view and is rate limited. */
  verify: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({ data: await CertificateService.verify(req.params.code as string) });
  }),

  revoke: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await CertificateService.revoke(
      req.params.code as string,
      userId,
      (req.body as { reason: string }).reason,
    );
    res.status(200).json({ data: result });
  }),
};
