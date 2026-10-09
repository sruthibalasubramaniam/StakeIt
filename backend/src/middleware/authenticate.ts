import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthenticated } from '../lib/errors';
import { verifyAccessToken } from '../services/tokenService';
import { env } from '../config/env';
import { verifySupabaseAccessToken } from '../lib/supabase';
import type { AuthContext } from '../types/auth';

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

/**
 * Verifies the bearer token and resolves it to a local user record.
 *
 * The role is ALWAYS read from the database — a role claim inside the token
 * (or anything the client sends) is never trusted for authorization.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw unauthenticated('Missing bearer token.');
    }

    let context: AuthContext;

    if (env.AUTH_PROVIDER === 'supabase') {
      const payload = await verifySupabaseAccessToken(token);
      const supabaseId = String(payload.sub ?? '');
      if (!supabaseId) throw unauthenticated('Access token is missing a subject claim.');

      const user = await prisma.user.findFirst({ where: { supabaseId } });
      if (!user) {
        throw unauthenticated(
          'No Stake It profile is linked to this account yet. Complete registration first.',
        );
      }
      context = { userId: user.id, email: user.email, role: user.role, source: 'supabase' };
    } else {
      const claims = verifyAccessToken(token);
      context = { userId: claims.sub, email: claims.email, role: claims.role, source: 'local' };
    }

    // Guards against stale tokens for deactivated or role-changed accounts.
    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user) throw unauthenticated('Account no longer exists.');
    if (!user.isActive) throw forbidden('This account has been deactivated. Contact an administrator.');

    req.auth = { ...context, email: user.email, role: user.role as Role };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Like `authenticate` but never rejects: used by endpoints that render
 * differently for signed-in users (e.g. course detail with enrolment state).
 */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!extractBearerToken(req)) {
    next();
    return;
  }
  await authenticate(req, res, (error?: unknown) => {
    if (error) {
      // A broken token on an optional route is still an authentication failure.
      next(error);
      return;
    }
    next();
  });
}
