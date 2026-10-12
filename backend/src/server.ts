import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { connectWithRetry, isDatabaseReady, prisma } from './lib/prisma';
import { startScheduler, stopScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  const app = createApp();

  /*
   * The listener is opened FIRST and the database is connected in the
   * background. That ordering is what removes the 502:
   *
   *   - nginx always finds a live upstream, so it never answers "Bad Gateway";
   *   - while the database is still unreachable the API answers an honest
   *     503 SERVICE_UNAVAILABLE (see the readiness gate in `createApp`);
   *   - the process never exits, so Docker's restart backoff cannot stretch the
   *     recovery out to a minute per attempt.
   *
   * The previous behaviour — connect, and `process.exit(1)` on failure — meant a
   * database that was not yet routable at container start produced a restart
   * loop and a 502 for every request, including `POST /api/auth/login`.
   */
  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        authProvider: env.AUTH_PROVIDER,
        apiPrefix: env.API_PREFIX,
      },
      `Stake It API listening on http://localhost:${env.PORT}${env.API_PREFIX}`,
    );
  });

  void connectWithRetry({
    maxAttempts: env.DB_CONNECT_MAX_ATTEMPTS,
    initialDelayMs: env.DB_CONNECT_INITIAL_DELAY_MS,
    maxDelayMs: env.DB_CONNECT_MAX_DELAY_MS,
    onAttempt: (attempt, error) => {
      logger.warn(
        { attempt, err: error },
        'database not reachable yet — retrying in the background (the API stays up and answers 503 on data routes)',
      );
    },
  }).then((connected) => {
    if (connected) {
      logger.info('database connection established');
      // Jobs query the database, so the scheduler only starts once it is usable.
      startScheduler();
      return;
    }
    logger.error(
      'Gave up connecting to PostgreSQL after the configured attempts. Check DATABASE_URL and that the database is running (docker compose up postgres). The API keeps serving 503 until a restart retries the connection.',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Do not hang forever on keep-alive connections.
      setTimeout(resolve, 10_000).unref();
    });

    await prisma.$disconnect().catch(() => undefined);
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception — exiting');
    void shutdown('uncaughtException');
  });

  // Surfaced so the health route and tests can assert on real state.
  logger.debug({ databaseReady: isDatabaseReady() }, 'startup complete');
}

void main();
