import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env, corsOrigins, isTest } from './config/env';
import { logger } from './lib/logger';
import { isDatabaseReady } from './lib/prisma';
import { apiRouter } from './routes';
import { requestContext } from './middleware/requestContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { serviceUnavailable } from './lib/errors';

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` so integration tests can mount the app with
 * supertest without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy (docker/nginx) the real client IP arrives in
  // X-Forwarded-For; without this express-rate-limit would bucket every user
  // together. The hop count is configurable via TRUST_PROXY (0 = not proxied).
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; a strict CSP here would fight the SPA served
      // separately, so cross-origin resource policy is relaxed for the client.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin/native clients send no Origin header.
        if (!origin) return callback(null, true);
        if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // `x-file-name` / `x-resource-title` carry the display name of a raw PDF
      // upload (see `routes/reading.routes.ts`).
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-request-id',
        'x-file-name',
        'x-resource-title',
        // Import: skip the AI drafting pass.
        'x-ai-checkpoints',
      ],
      exposedHeaders: ['x-request-id'],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestContext);

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as { requestId?: string }).requestId ?? '',
        autoLogging: {
          ignore: (req) => req.url === `${env.API_PREFIX}/health` || req.url === '/health',
        },
      }),
    );
  }

  // Liveness probe is also exposed at the root for container orchestrators.
  app.get('/', (_req, res) => {
    res.json({
      data: {
        name: 'Stake It API',
        version: '1.0.0',
        docs: `${env.API_PREFIX}/health`,
        description: 'Incentive-driven adaptive learning platform. Virtual points only — no real money.',
      },
    });
  });

  /*
   * Readiness gate.
   *
   * The listener now starts before the database is reachable (see `server.ts`),
   * so every data route has to be honest about the gap: until a connection has
   * succeeded the API answers 503 SERVICE_UNAVAILABLE with the standard error
   * envelope. The client can then say "the database is still starting" instead
   * of surfacing a proxy-level 502 or a generic 500.
   *
   * `/health` is deliberately outside the gate — it is the endpoint that reports
   * the database state, and the container healthcheck depends on it.
   */
  app.use(env.API_PREFIX, (req, _res, next) => {
    if (req.originalUrl.startsWith(`${env.API_PREFIX}/health`) || isDatabaseReady()) {
      next();
      return;
    }
    next(
      serviceUnavailable(
        'The database is still starting up. Please retry in a few seconds.',
        { reason: 'DATABASE_NOT_READY' },
      ),
    );
  });

  app.use(env.API_PREFIX, apiLimiter, apiRouter);

  // 404 for anything unmatched, then the centralised error translator.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
