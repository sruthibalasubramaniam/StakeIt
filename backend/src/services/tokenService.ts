import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { unauthenticated } from '../lib/errors';

const BCRYPT_ROUNDS = 10;

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function comparePassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(params: { userId: string; email: string; role: Role }): {
  accessToken: string;
  expiresIn: string;
} {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: 'stake-it-api',
    subject: params.userId,
  };

  const accessToken = jwt.sign({ email: params.email, role: params.role }, env.JWT_SECRET, options);
  return { accessToken, expiresIn: env.JWT_EXPIRES_IN };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { issuer: 'stake-it-api' });
    if (typeof decoded === 'string') throw unauthenticated('Malformed access token.');

    const subject = String(decoded.sub ?? '');
    if (!subject) throw unauthenticated('Access token is missing a subject claim.');

    return {
      sub: subject,
      email: String(decoded.email ?? ''),
      role: decoded.role as Role,
      iat: decoded.iat,
      exp: decoded.exp,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw unauthenticated('Your session has expired. Sign in again.', 'TOKEN_EXPIRED');
    }
    if (error instanceof Error && ['JsonWebTokenError', 'NotBeforeError'].includes(error.name)) {
      throw unauthenticated('The access token is invalid.');
    }
    throw error;
  }
}
