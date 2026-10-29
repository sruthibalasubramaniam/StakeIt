import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load `.env` from the backend workspace (and fall back to the repo root).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

/**
 * Development fallback secret. It is permitted outside production so a fresh
 * clone runs immediately, but `superRefine` below refuses it in production.
 */
export const DEV_JWT_SECRET_PLACEHOLDER = 'stake_it_dev_secret_change_me';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Startup reconnection policy. A managed pooler (Supabase) or a
   * `depends_on` PostgreSQL is often unreachable for the first minute or two
   * after `docker compose up`; the API retries in the background instead of
   * exiting, so nginx never sees a dead upstream (which it reports as 502).
   *
   * `0` attempts means "retry until it works" — the default, because giving up
   * would strand the container in a permanently degraded state.
   */
  DB_CONNECT_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(0),
  DB_CONNECT_INITIAL_DELAY_MS: z.coerce.number().int().positive().default(1_000),
  DB_CONNECT_MAX_DELAY_MS: z.coerce.number().int().positive().default(5_000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  /**
   * Interactive-transaction budget for `withTransaction`.
   *
   * Settlement (wallet credits + ledger + stakes + enrolment in one atomic unit)
   * is the longest transaction in the system. The 15 s default is comfortable on
   * a local database, but a remote pooler can need 5–20 s per statement under
   * load, which surfaces as `P2028: transaction already closed`. Raise this for
   * remote/high-latency databases rather than loosening the transaction itself.
   */
  TX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  TX_MAX_WAIT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default(DEV_JWT_SECRET_PLACEHOLDER),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(6).default(8),

  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().optional().default('course-assets'),

  /**
   * Reading-lesson storage.
   *
   * `READING_PDF_MAX_MB` caps the raw upload accepted by
   * `POST /api/content/:id/reading/resources/upload`; the Express raw-body
   * limit is derived from it so the two can never disagree.
   * `READING_SIGNED_URL_TTL_SECONDS` is the lifetime of the signed Supabase
   * Storage URL handed to a learner or instructor for a private PDF.
   */
  READING_PDF_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),
  READING_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),

  /**
   * Optional AI provider.
   *
   * Deliberately optional: with `AI_API_KEY` unset every AI endpoint answers
   * `503 AI_UNAVAILABLE` and the rest of the product is unaffected. All three
   * supported providers expose an OpenAI-compatible chat-completions route, so a
   * single client covers them and `AI_BASE_URL` is the only difference.
   */
  AI_PROVIDER: z.enum(['openai', 'gemini', 'anthropic', 'compatible']).optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8_000).default(3_000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),

  /**
   * Transactional email (Resend). Off unless explicitly enabled *and* a key and
   * from-address are present, so a half-configured environment never sends.
   *
   * `EMAIL_FROM` must be an address on a domain verified in Resend — a
   * `resend.dev` sender can only deliver to your own account address.
   */
  EMAIL_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),

  /**
   * `resend` needs a verified domain. `smtp` sends through a real mailbox, which
   * is the only way to send *from* an address on a domain you do not control
   * (e.g. a Gmail account) — the mailbox itself authenticates the sender.
   */
  EMAIL_PROVIDER: z.enum(['resend', 'smtp']).optional().default('resend'),
  SMTP_HOST: z.string().optional().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(465),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === 'true')),
  SMTP_USER: z.string().optional(),
  /** Gmail requires an App Password here, not the account password. */
  SMTP_PASS: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  EMAIL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  /** Public origin used in email links. */
  APP_URL: z.string().optional().default('http://localhost:5173'),

  /** Name printed on certificates as the issuing body. */
  CERTIFICATE_ISSUER: z.string().optional().default('Stake It Academy'),

  SIGNUP_WALLET_GRANT: z.coerce.number().int().min(0).default(1500),
  DEADLINE_JOB_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  NOTIFICATION_JOB_ENABLED: booleanish.default(true),
  AT_RISK_THRESHOLD_PERCENT: z.coerce.number().min(0).max(100).default(15),

  // Set to "false" to disable the in-process scheduler (used by tests).
  SCHEDULER_ENABLED: booleanish.default(true),

  /**
   * Number of reverse-proxy hops in front of the API. Required for rate
   * limiting to see real client IPs behind nginx / a load balancer. `0` means
   * the API is directly exposed.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
})
  .superRefine((config, ctx) => {
    // --- Secrets that must never survive into production -------------------
    if (config.NODE_ENV === 'production') {
      {
        if (config.JWT_SECRET === DEV_JWT_SECRET_PLACEHOLDER) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['JWT_SECRET'],
            message:
              'JWT_SECRET is still the development placeholder. Set a unique random secret before running in production.',
          });
        } else if (config.JWT_SECRET.length < 32) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['JWT_SECRET'],
            message: 'JWT_SECRET must be at least 32 characters in production.',
          });
        }
      }

      // A wildcard CORS policy in production would let any site call the API
      // with a user's credentials.
      if (config.CORS_ORIGIN.split(',').some((origin) => origin.trim() === '*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN must list explicit origins in production; "*" is not allowed.',
        });
      }
    }

  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Comma-separated origins are supported, e.g. `http://a.com,http://b.com`. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

