import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { cn } from '../utils/cn';
import { useAuth } from '../context/AuthContext';
import { Avatar, MaterialIcon, Spinner } from '../components/ui/core';
import { notificationApi } from '../services/endpoints';
import type { Role } from '../types/api';

interface NavItem {
  to: string;
  label: string;
}

/** Role-aware primary navigation, mirroring the design's header tabs. */
const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  LEARNER: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/courses', label: 'Courses' },
    { to: '/my-courses', label: 'My Courses' },
    { to: '/stakes', label: 'Stakes' },
    { to: '/wallet', label: 'Wallet' },
    { to: '/rewards', label: 'Rewards' },
  ],
  INSTRUCTOR: [
    { to: '/instructor/dashboard', label: 'Dashboard' },
    { to: '/instructor/courses', label: 'Courses' },
    { to: '/wallet', label: 'Wallet' },
  ],
  ADMIN: [
    { to: '/admin/dashboard', label: 'Dashboard' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/courses', label: 'Courses' },
    { to: '/admin/instructors', label: 'Instructors' },
    { to: '/admin/reward-pool', label: 'Reward Pool' },
    { to: '/admin/badges', label: 'Badges' },
  ],
};

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
 * Application chrome: fixed header (wordmark · role chip · nav · balance ·
 * notifications · avatar) plus the footer from the supplied design.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const role = user?.role ?? 'LEARNER';
  const navItems = NAV_BY_ROLE[role];

  // Unread badge — polled rather than pushed; the API exposes no stream.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const result = await notificationApi.unreadCount();
        if (!cancelled) setUnreadCount(result.unreadCount);
      } catch {
        // A failed badge refresh must never disrupt the page.
      }
    };

    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [user?.id]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between px-gutter-mobile md:px-margin">
          {/* Wordmark + role chip */}
          <div className="flex items-center gap-space-md">
            <NavLink to={homePathFor(role)} className="flex items-center gap-space-md">
              <span className="font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface">Stake It</span>
              <span className="hidden rounded border border-outline-variant bg-surface-container-low px-space-sm py-0.5 micro-label text-on-surface-variant sm:inline-block">
                {role}
              </span>
            </NavLink>
          </div>

          {/* Desktop navigation */}
          <nav className="hidden h-full items-center gap-space-lg lg:flex" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex h-14 items-center border-b-2 px-0.5 font-label-md text-label-md transition-colors',
                    isActive
                      ? 'border-primary text-on-surface'
                      : 'border-transparent text-on-surface-variant hover:text-on-surface',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-space-sm">
            {user ? (
              <NavLink
                to="/wallet"
                className="hidden items-center gap-1.5 rounded border border-outline-variant bg-surface-container-lowest px-space-sm py-1 font-mono text-label-sm tabular text-on-surface transition-colors hover:bg-surface-container-low sm:flex"
                title="Available points"
              >
                <MaterialIcon name="account_balance_wallet" className="text-[15px] text-on-surface-variant" />
                {user.wallet.availableBalance.toLocaleString('en-US')} pts
              </NavLink>
            ) : null}

            <NavLink
              to="/notifications"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              className="relative inline-flex h-9 w-9 items-center justify-center rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low"
            >
              <MaterialIcon name="notifications" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-mono text-[10px] text-on-error">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </NavLink>

            {user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label="Account menu"
                  className="inline-flex items-center gap-space-sm rounded border border-transparent p-0.5 hover:border-outline-variant"
                >
                  <Avatar name={user.fullName} url={user.avatarUrl} />
                </button>

                {menuOpen ? (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                    <div
                      role="menu"
                      className="absolute right-0 top-10 z-50 w-56 rounded border border-outline-variant bg-surface-container-lowest py-space-xs shadow-[0_4px_12px_rgba(15,23,42,0.05)]"
                    >
                      <div className="border-b border-outline-variant px-space-md py-space-sm">
                        <p className="truncate font-label-md text-label-md text-on-surface">{user.fullName}</p>
                        <p className="truncate font-body-sm text-body-sm text-on-surface-variant">{user.email}</p>
                      </div>
                      <NavLink to="/profile" role="menuitem" className="block px-space-md py-space-sm font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface">
                        Profile
                      </NavLink>
                      <NavLink to="/notifications" role="menuitem" className="block px-space-md py-space-sm font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface">
                        Notifications
                      </NavLink>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void logout()}
                        className="block w-full px-space-md py-space-sm text-left font-label-sm text-label-sm text-error hover:bg-error-container/30"
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* Mobile navigation toggle */}
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation"
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant lg:hidden"
            >
              <MaterialIcon name={mobileOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>

        {/* Mobile navigation drawer */}
        {mobileOpen ? (
          <nav className="border-t border-outline-variant bg-surface-container-lowest lg:hidden" aria-label="Mobile">
            <ul className="mx-auto max-w-content px-gutter-mobile py-space-sm">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'block rounded px-space-md py-space-sm font-label-md text-label-md',
                        isActive ? 'bg-primary-fixed/60 text-primary' : 'text-on-surface-variant hover:bg-surface-container-low',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
              <li className="mt-space-xs border-t border-outline-variant pt-space-xs">
                <NavLink to="/profile" className="block rounded px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-low">
                  Profile
                </NavLink>
              </li>
            </ul>
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-gutter-mobile py-space-xl md:px-margin">
        <Outlet />
      </main>

      <footer className="border-t border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto flex max-w-content items-center px-gutter-mobile py-space-md md:px-margin">
          <span className="font-label-xs text-label-xs text-on-surface-variant">
            © {new Date().getFullYear()} Stake It. Virtual platform points only — no real money.
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Full-page splash used while the initial session probe runs. */
export function AppBootSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-space-md bg-background">
      <span className="font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface">Stake It</span>
      <span className="flex items-center gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
        <Spinner />
        Restoring your session…
      </span>
    </div>
  );
}
