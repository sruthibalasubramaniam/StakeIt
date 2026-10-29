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

/**
 * Certificate verification is public, so it gets its own tight bucket to stop
 * bulk guessing of codes.
 */
export const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonLimitHandler('Too many verification attempts. Try again later.'),
});

/**
 * AI requests cost money per call, so they are capped well below the general API
 * budget. Kept per-IP like the other limiters (the host is a single server).
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonLimitHandler('That is a lot of AI requests — please wait a bit before trying again.'),
});

/**
 * Reading PDF uploads write to object storage, so they are limited per instructor
 * far below the general API budget. Uploading a course's worth of documents is
 * still possible in a session; hammering the bucket is not.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonLimitHandler('Too many uploads. Please wait before adding more course files.'),
});
