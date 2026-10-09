import pino from 'pino';
import { env, isProduction, isTest } from '../config/env';

/**
 * Pretty printing for local development only.
 *
 * `pino-pretty` is a devDependency, and inside a container npm may place it
 * somewhere pino's transport worker cannot resolve (it resolves relative to the
 * pino package, not the app). A log formatter must never take the process down,
 * so the transport is enabled only when the module actually resolves. Otherwise
 * logs are emitted as plain JSON — which is what container log collectors want
 * anyway.
 *
 * This was a genuine crash-loop found by running the container: the API died at
 * `pino()` with `unable to determine transport target for "pino-pretty"`.
 */
function prettyTransport(): { target: string; options: Record<string, unknown> } | undefined {
  if (isProduction || isTest) return undefined;

  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
  };
}

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[redacted]',
  },
  transport: prettyTransport(),
});

export type Logger = typeof logger;
