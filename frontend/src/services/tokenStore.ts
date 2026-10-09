/**
 * Access-token persistence.
 *
 * Kept in its own module so the axios interceptor and the auth context can both
 * read it without importing each other (which would create a cycle).
 */
const TOKEN_KEY = 'stakeit.accessToken';

export const tokenStore = {
  get(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage disabled — session stays in memory only */
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Fired when the API rejects a token so the app can drop the session. */
export const UNAUTHORIZED_EVENT = 'stakeit:unauthorized';
