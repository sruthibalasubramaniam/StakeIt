import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Attaches a correlation id used in logs and error envelopes. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
