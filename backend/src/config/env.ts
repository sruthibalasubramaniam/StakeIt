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

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default(DEV_JWT_SECRET_PLACEHOLDER),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(6).default(8),

  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_JWT_SECRET: z.string().optional().default(''),
  SUPABASE_JWT_AUDIENCE: z.string().optional().default('authenticated'),
  SUPABASE_STORAGE_BUCKET: z.string().optional().default('course-assets'),

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
      if (config.AUTH_PROVIDER === 'local') {
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

    // --- Supabase Auth requires an endpoint and a way to verify tokens -----
    if (config.AUTH_PROVIDER === 'supabase') {
      if (!config.SUPABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_URL'],
          message: 'SUPABASE_URL is required when AUTH_PROVIDER=supabase.',
        });
      }
      if (!config.SUPABASE_ANON_KEY && !config.SUPABASE_JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_ANON_KEY'],
          message:
            'Set SUPABASE_ANON_KEY (to sign users in) or SUPABASE_JWT_SECRET (to verify tokens) when AUTH_PROVIDER=supabase.',
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

export const supabaseConfigured = Boolean(env.SUPABASE_URL && (env.SUPABASE_ANON_KEY || env.SUPABASE_JWT_SECRET));
