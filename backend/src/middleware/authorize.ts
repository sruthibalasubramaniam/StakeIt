import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { forbidden, unauthenticated } from '../lib/errors';
import type { AuthContext } from '../types/auth';

/** Requires an authenticated request. */
export function requireAuth(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    next();
  };
}

/**
 * Role-based authorization. Role is taken from the database-backed
 * `req.auth` context, never from the request body or query.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(
        forbidden('Your role does not have access to this resource.', {
          requiredRoles: roles,
          actualRole: req.auth.role,
        }),
      );
      return;
    }
    next();
  };
}

export function authContext(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

export const isAdmin = (req: Request): boolean => req.auth?.role === 'ADMIN';
export const isInstructor = (req: Request): boolean => req.auth?.role === 'INSTRUCTOR';
