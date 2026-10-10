import { useAuth } from '../context/AuthContext';
import type { Role } from '../types/api';

/**
 * Role-aware routing primitives.
 *
 * Single source of truth shared by the route guards, the post-login redirect
 * and every in-page link that points into a role-owned area. Keeping this in
 * one module is what stops the app from offering a role a link it cannot open
 * (which previously produced a 403 "Back to safety" screen after a role switch).
 */

export const ALL_ROLES: readonly Role[] = ['LEARNER', 'INSTRUCTOR', 'ADMIN'];

/** Where each role lands after authenticating. */
export function homePathFor(role: Role): string {
  switch (role) {
    case 'INSTRUCTOR':
      return '/instructor/dashboard';
    case 'ADMIN':
      return '/admin/dashboard';
    default:
      return '/dashboard';
  }
}

/**
 * Base path of the course-authoring area for a role.
 *
 * `null` means the role has no authoring area at all (learners).
 */
export function courseAreaBaseFor(role: Role): string | null {
  if (role === 'ADMIN') return '/admin/courses';
  if (role === 'INSTRUCTOR') return '/instructor/courses';
  return null;
}

/**
 * Course-authoring base path for the *signed-in* role.
 *
 * Shared authoring screens (builder, learners, analytics, course form) use this
 * so an administrator stays inside `/admin/courses` instead of being sent into
 * the instructor area — and vice versa.
 */
export function useCourseAreaBase(): string {
  const { role } = useAuth();
  return courseAreaBaseFor(role ?? 'LEARNER') ?? '/courses';
}

/**
 * Route table mirrored as data.
 *
 * Order matters: the first matching rule wins, so the narrower paths
 * (`/courses/:slug/enroll`) are declared before the broader ones (`/courses`).
 */
const ACCESS_RULES: ReadonlyArray<{ test: (pathname: string) => boolean; allow: readonly Role[] }> = [
  /* Learner-owned */
  { test: (pathname) => pathname === '/dashboard', allow: ['LEARNER'] },
  { test: (pathname) => /^\/courses\/[^/]+\/enroll\/?$/.test(pathname), allow: ['LEARNER'] },
  { test: (pathname) => pathname === '/my-courses', allow: ['LEARNER'] },
  { test: (pathname) => pathname === '/learn' || pathname.startsWith('/learn/'), allow: ['LEARNER'] },
  { test: (pathname) => pathname === '/stakes' || pathname === '/rewards', allow: ['LEARNER'] },

  /* Role-owned areas — strictly one role each */
  { test: (pathname) => pathname === '/instructor' || pathname.startsWith('/instructor/'), allow: ['INSTRUCTOR'] },
  { test: (pathname) => pathname === '/admin' || pathname.startsWith('/admin/'), allow: ['ADMIN'] },

  /* Shared, readable by every signed-in role */
  { test: (pathname) => pathname === '/courses' || pathname.startsWith('/courses/'), allow: ['LEARNER', 'INSTRUCTOR', 'ADMIN'] },
  { test: (pathname) => pathname.startsWith('/instructors/'), allow: ['LEARNER', 'INSTRUCTOR', 'ADMIN'] },
  { test: (pathname) => pathname === '/wallet', allow: ['LEARNER', 'INSTRUCTOR', 'ADMIN'] },
  { test: (pathname) => pathname === '/notifications', allow: ['LEARNER', 'INSTRUCTOR', 'ADMIN'] },
  { test: (pathname) => pathname === '/profile', allow: ['LEARNER', 'INSTRUCTOR', 'ADMIN'] },
];

/**
 * Whether `role` may open `pathname`.
 *
 * Unknown paths return `false` so they are never honoured as a post-login
 * destination — the router renders a 404 for those anyway.
 */
export function isPathAllowedForRole(pathname: string, role: Role): boolean {
  const clean = pathname.split('?')[0].split('#')[0] || '/';
  if (clean === '/') return true;
  const rule = ACCESS_RULES.find((entry) => entry.test(clean));
  return rule ? rule.allow.includes(role) : false;
}

/** Path only (no query/hash), for use with `isPathAllowedForRole`. */
export function pathnameOf(target: string): string {
  return target.split('?')[0].split('#')[0];
}
