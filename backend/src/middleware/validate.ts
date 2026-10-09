import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, z, type ZodTypeAny } from 'zod';
import { badRequest } from '../lib/errors';

/**
 * A schema may be given either as a ready-made zod schema or as a plain record
 * of field schemas, e.g. `{ params: { moduleId: uuidParam } }`. The record form
 * keeps route definitions readable when only one or two fields are validated.
 */
export type SchemaLike = ZodTypeAny | Record<string, ZodTypeAny>;

export interface ValidationSchemas {
  body?: SchemaLike;
  query?: SchemaLike;
  params?: SchemaLike;
}

function toSchema(input: SchemaLike): ZodTypeAny {
  return typeof (input as ZodTypeAny).parse === 'function'
    ? (input as ZodTypeAny)
    : z.object(input as Record<string, ZodTypeAny>);
}

function formatIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validates and *replaces* `req.body` / `req.query` / `req.params` with the
 * parsed result, so downstream handlers work with typed, coerced values.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        const parsed = toSchema(schemas.params).parse(req.params);
        Object.defineProperty(req, 'params', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.query) {
        const parsed = toSchema(schemas.query).parse(req.query);
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) {
        req.body = toSchema(schemas.body).parse(req.body ?? {});
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(badRequest('The submitted data failed validation.', { issues: formatIssues(error) }));
        return;
      }
      next(error);
    }
  };
}
