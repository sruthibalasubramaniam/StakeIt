import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '../services/endpoints';
import { ApiClientError } from '../services/api';
import { UNAUTHORIZED_EVENT, tokenStore } from '../services/tokenStore';
import type { AuthenticatedUser, Role } from '../types/api';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  /** True while the initial session probe is running. */
  initialising: boolean;
  isAuthenticated: boolean;
  role: Role | null;
  login: (email: string, password: string) => Promise<AuthenticatedUser>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
    role?: 'LEARNER' | 'INSTRUCTOR';
    headline?: string;
  }) => Promise<AuthenticatedUser>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateUser: (user: AuthenticatedUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [initialising, setInitialising] = useState(true);

  /** Loads the profile for an existing token on first paint. */
  const refreshProfile = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      const profile = await authApi.profile();
      setUser(profile);
    } catch {
      // Expired or revoked token — drop it silently.
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshProfile().finally(() => setInitialising(false));
  }, [refreshProfile]);

  // The axios interceptor broadcasts 401s; clear the session when it does.
  useEffect(() => {
    const handler = () => {
      tokenStore.clear();
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login({ email, password });
    tokenStore.set(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; fullName: string; role?: 'LEARNER' | 'INSTRUCTOR'; headline?: string }) => {
      const result = await authApi.register(input);
      tokenStore.set(result.accessToken);
      setUser(result.user);
      return result.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // A failed server-side revocation must never trap the user in the app.
      if (error instanceof ApiClientError && error.status === 0) {
        /* offline — fall through */
      }
    } finally {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initialising,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      login,
      register,
      logout,
      refreshProfile,
      updateUser: setUser,
    }),
    [user, initialising, login, register, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
