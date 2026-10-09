/**
 * Supabase integration.
 *
 * Two responsibilities:
 *  1. `SupabaseAuthClient` — credential sign-up / sign-in delegated to the
 *     Supabase GoTrue REST API (used when AUTH_PROVIDER=supabase).
 *  2. `verifySupabaseAccessToken` — offline verification of Supabase access
 *     tokens. HS256 tokens are checked against `SUPABASE_JWT_SECRET`;
 *     asymmetric (RS256/ES256) tokens are verified against the project JWKS.
 *
 * When AUTH_PROVIDER=local none of this is required and the API issues its own
 * HS256 tokens (`AuthService`), which keeps the whole stack runnable offline.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env, supabaseConfigured } from '../config/env';
import { ApiError, serviceUnavailable, unauthenticated } from './errors';

export interface SupabaseSession {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  userId: string;
  email: string;
  payload: Record<string, unknown>;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!env.SUPABASE_URL) return null;
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export function assertSupabaseConfigured(): void {
  if (!supabaseConfigured) {
    throw serviceUnavailable(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or use AUTH_PROVIDER=local).',
    );
  }
}

/**
 * Verifies a Supabase access token without a network round-trip for HS256
 * projects, falling back to JWKS for asymmetric signing keys.
 */
export async function verifySupabaseAccessToken(token: string): Promise<JWTPayload> {
  const audience = env.SUPABASE_JWT_AUDIENCE || 'authenticated';
  const issuer = env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined;

  if (env.SUPABASE_JWT_SECRET) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
        issuer ? { issuer, audience } : { audience },
      );
      return payload;
    } catch (error) {
      // Fall through to JWKS only when the project actually uses asymmetric keys.
      if (!env.SUPABASE_URL) {
        throw unauthenticated('Supabase access token could not be verified.', 'UNAUTHENTICATED');
      }
      void error;
    }
  }

  const jwksSet = getJwks();
  if (!jwksSet) {
    throw unauthenticated('Supabase access token could not be verified.', 'UNAUTHENTICATED');
  }

  try {
    const { payload } = await jwtVerify(token, jwksSet, issuer ? { issuer, audience } : { audience });
    return payload;
  } catch {
    throw unauthenticated('Supabase access token is invalid or expired.', 'UNAUTHENTICATED');
  }
}

interface GoTrueUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

interface GoTrueSessionResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: GoTrueUser;
}

interface GoTrueUserResponse extends GoTrueUser {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function callGoTrue<T>(path: string, init: RequestInit): Promise<T> {
  assertSupabaseConfigured();
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/auth/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      (body.msg as string) ||
      (body.error_description as string) ||
      (body.error as string) ||
      'Supabase authentication request failed.';
    const status = response.status === 400 || response.status === 401 ? 401 : response.status;
    throw new ApiError(status, 'INVALID_CREDENTIALS', message);
  }

  return body as T;
}

function sessionFromGoTrueResult(result: GoTrueSessionResponse | GoTrueUserResponse, email: string): SupabaseSession {
  const user = 'user' in result && result.user ? result.user : 'id' in result ? result : undefined;

  if (!user?.id) {
    throw new ApiError(
      502,
      'SERVICE_UNAVAILABLE',
      'Supabase Auth returned an unexpected response. Use AUTH_PROVIDER=local for local development or check the Supabase Auth settings.',
    );
  }

  if (!result.access_token) {
    throw new ApiError(
      409,
      'CONFLICT',
      'Supabase created the account but did not return a session. Email confirmation may be enabled; use AUTH_PROVIDER=local for immediate local sign-in.',
    );
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresIn: result.expires_in,
    userId: user.id,
    email: user.email ?? email,
    payload: (user.user_metadata ?? {}) as Record<string, unknown>,
  };
}

export const SupabaseAuthClient = {
  async signUpWithPassword(params: {
    email: string;
    password: string;
    metadata?: Record<string, unknown>;
  }): Promise<SupabaseSession> {
    const result = await callGoTrue<GoTrueSessionResponse | GoTrueUserResponse>('/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        data: params.metadata ?? {},
      }),
    });

    return sessionFromGoTrueResult(result, params.email);
  },

  async signInWithPassword(params: { email: string; password: string }): Promise<SupabaseSession> {
    const result = await callGoTrue<GoTrueSessionResponse>('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    return sessionFromGoTrueResult(result, params.email);
  },

  async signOut(accessToken: string): Promise<void> {
    await callGoTrue('/logout', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }).catch(
      () => undefined,
    );
  },
};

/** Public URL for an object stored in the configured Supabase Storage bucket. */
export function courseAssetPublicUrl(objectPath: string): string | null {
  if (!env.SUPABASE_URL) return null;
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}/${objectPath.replace(/^\//, '')}`;
}
