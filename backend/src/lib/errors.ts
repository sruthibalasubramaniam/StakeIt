/**
 * Typed application errors.
 *
 * Controllers throw these; `errorHandler` converts them into a stable JSON
 * envelope so the client never has to guess at an error shape:
 *
 *   { "error": { "code": "CONTENT_LOCKED", "message": "...", "details": {...} } }
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_BALANCE'
  | 'ALREADY_ENROLLED'
  | 'CONTENT_LOCKED'
  | 'CHECKPOINT_REQUIRED'
  | 'MODULE_LOCKED'
  | 'AI_UNAVAILABLE'
  | 'AI_FAILED'
  | 'EMAIL_UNAVAILABLE'
  | 'EMAIL_FAILED'
  | 'FINAL_TEST_LOCKED'
  | 'ATTEMPT_LIMIT_REACHED'
  | 'ATTEMPT_NOT_ACTIVE'
  | 'DEADLINE_MISSED'
  | 'INVALID_COURSE_CONFIGURATION'
  | 'INVALID_PROGRESS'
  | 'ALREADY_SETTLED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** Marks the error as an expected outcome rather than an unexpected crash. */
  readonly isOperational = true;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }
}

export const badRequest = (message: string, details?: unknown, code: ErrorCode = 'VALIDATION_ERROR') =>
  new ApiError(400, code, message, details);

export const unauthenticated = (message = 'Authentication is required.', code: ErrorCode = 'UNAUTHENTICATED') =>
  new ApiError(401, code, message);

export const invalidCredentials = (message = 'Email or password is incorrect.') =>
  new ApiError(401, 'INVALID_CREDENTIALS', message);

export const forbidden = (message = 'You do not have permission to perform this action.', details?: unknown) =>
  new ApiError(403, 'FORBIDDEN', message, details);

export const notFound = (resource = 'Resource', details?: unknown) =>
  new ApiError(404, 'NOT_FOUND', `${resource} was not found.`, details);

export const conflict = (message: string, code: ErrorCode = 'CONFLICT', details?: unknown) =>
  new ApiError(409, code, message, details);

export const insufficientBalance = (message: string, details?: unknown) =>
  new ApiError(422, 'INSUFFICIENT_BALANCE', message, details);

export const unprocessable = (message: string, code: ErrorCode, details?: unknown) =>
  new ApiError(422, code, message, details);

export const serviceUnavailable = (message: string, details?: unknown) =>
  new ApiError(503, 'SERVICE_UNAVAILABLE', message, details);

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
