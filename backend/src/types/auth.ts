import type { Role } from '@prisma/client';

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  /** `local` = HS256 token issued by this API, `supabase` = Supabase access token. */
  source: 'local';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId: string;
    }
  }
}

export {};
