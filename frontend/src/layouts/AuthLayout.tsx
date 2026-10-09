import { Outlet } from 'react-router-dom';

/**
 * Shell for unauthenticated screens. Keeps the same near-white surface,
 * hairline card and centred measure as the rest of the design rather than
 * inventing a separate marketing look.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto flex h-14 max-w-content items-center px-gutter-mobile md:px-margin">
          <span className="font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface">Stake It</span>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-gutter-mobile py-space-xl md:px-margin">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
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
