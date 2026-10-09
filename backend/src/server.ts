import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startScheduler, stopScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  // Fail fast with a clear message when the database is unreachable.
  try {
    await prisma.$connect();
    logger.info('database connection established');
  } catch (error) {
    logger.error(
      { err: error },
      'Unable to connect to PostgreSQL. Check DATABASE_URL and that the database is running (docker compose up postgres).',
    );
    process.exit(1);
  }

  const app = createApp();

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

  startScheduler();

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
}

void main();
