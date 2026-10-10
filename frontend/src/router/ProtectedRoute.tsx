import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppBootSplash } from '../layouts/AppShell';
import { ForbiddenPage } from '../pages/errors/ErrorPages';
import { homePathFor } from './routeAccess';
import type { Role } from '../types/api';

/**
 * Route guard.
 *
 * This is a *convenience* guard only: every protected action is authorised
 * again on the server. Hiding a route here never substitutes for backend RBAC —
 * a learner who hand-types `/admin/users` still gets a 403 from the API.
 */
export function ProtectedRoute({ allow, children }: { allow?: Role[]; children?: ReactNode }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <AppBootSplash />;

  if (!user) {
    // Preserve the intended destination so login can return the user there.
    // `LoginPage` re-checks this against the role that actually signs in.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (allow && !allow.includes(user.role)) {
    return <ForbiddenPage requiredRoles={allow} actualRole={user.role} />;
  }

  return <>{children}</>;
}

/**
 * Guard for the sign-in / registration screens.
 *
 * An already-authenticated visitor is sent to their own role's home instead of
 * being shown a login form — otherwise signing in as a second role left the
 * previous role's session visually in place.
 */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, initialising } = useAuth();

  if (initialising) return <AppBootSplash />;
  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  return <>{children}</>;
}
