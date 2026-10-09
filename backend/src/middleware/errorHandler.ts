import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError, isApiError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isProduction } from '../config/env';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    stack?: string;
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ErrorEnvelope = {
    error: {
      code: 'NOT_FOUND',
      message: `No API route matches ${req.method} ${req.originalUrl}.`,
      requestId: req.requestId,
    },
  };
  res.status(404).json(body);
}

/** Maps known Prisma failures onto meaningful HTTP responses. */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): ApiError {
  const target = (error.meta?.target as string[] | string | undefined) ?? undefined;
  const fields = Array.isArray(target) ? target.join(', ') : target;

  switch (error.code) {
    case 'P2002':
      return new ApiError(409, 'CONFLICT', `A record with this ${fields ?? 'value'} already exists.`, {
        fields: target,
      });
    case 'P2003':
      return new ApiError(400, 'VALIDATION_ERROR', 'A referenced record does not exist.', {
        field: error.meta?.field_name,
      });
    case 'P2025':
      return new ApiError(404, 'NOT_FOUND', 'The requested record could not be found.');
    case 'P2014':
      return new ApiError(409, 'CONFLICT', 'This change would break a required relationship.');
    default:
      return new ApiError(500, 'INTERNAL_ERROR', 'A database error occurred.');
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  let apiError: ApiError;

  if (isApiError(error)) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = new ApiError(400, 'VALIDATION_ERROR', 'The submitted data failed validation.', {
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    apiError = mapPrismaError(error);
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    apiError = new ApiError(400, 'VALIDATION_ERROR', 'The request contained invalid data for the database layer.');
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    apiError = new ApiError(503, 'SERVICE_UNAVAILABLE', 'The database is unavailable. Try again shortly.');
  } else if (error instanceof Error && error.name === 'TokenExpiredError') {
    apiError = new ApiError(401, 'TOKEN_EXPIRED', 'Your session has expired. Sign in again.');
  } else if (error instanceof Error && (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError')) {
    apiError = new ApiError(401, 'UNAUTHENTICATED', 'The access token is invalid.');
  } else if (error instanceof Error && (error as { type?: string }).type === 'entity.parse.failed') {
    apiError = new ApiError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
  } else if (error instanceof Error && error.name === 'PayloadTooLargeError') {
    apiError = new ApiError(413, 'VALIDATION_ERROR', 'Request payload is too large.');
  } else {
    apiError = new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }

  const isServerError = apiError.statusCode >= 500;

  if (isServerError) {
    logger.error(
      { err: error, requestId: req.requestId, method: req.method, url: req.originalUrl, userId: req.auth?.userId },
      apiError.message,
    );
  } else {
    logger.warn(
      { requestId: req.requestId, code: apiError.code, method: req.method, url: req.originalUrl },
      apiError.message,
    );
  }

  const body: ErrorEnvelope = {
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: req.requestId,
    },
  };

  if (apiError.details !== undefined) body.error.details = apiError.details;
  if (!isProduction && isServerError && error instanceof Error) body.error.stack = error.stack;

  res.status(apiError.statusCode).json(body);
}
