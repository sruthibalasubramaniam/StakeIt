import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const jsonLimitHandler = (message: string) => (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
};

/** Broad limiter for the whole API surface. */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonLimitHandler('Too many requests. Please slow down and try again shortly.'),
});

/** Tighter limiter for credential endpoints to blunt brute-force attempts. */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: jsonLimitHandler('Too many authentication attempts. Please wait a minute and try again.'),
});

/** Progress heartbeats are chatty by nature; give them their own generous bucket. */
export const progressLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX * 4,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonLimitHandler('Progress updates are arriving too quickly.'),
});
