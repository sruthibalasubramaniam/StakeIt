import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppBootSplash } from '../layouts/AppShell';
import { ForbiddenPage } from '../pages/errors/ErrorPages';
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
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (allow && !allow.includes(user.role)) {
    return <ForbiddenPage requiredRoles={allow} actualRole={user.role} />;
  }

  return <>{children}</>;
}
