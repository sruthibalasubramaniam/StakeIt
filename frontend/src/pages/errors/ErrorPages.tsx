import { Link, isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { Button, MaterialIcon } from '../../components/ui/core';
import type { Role } from '../../types/api';

function ErrorShell({
  code,
  icon,
  title,
  description,
  children,
}: {
  code: string;
  icon: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-space-xl">
      <div className="surface-card w-full max-w-xl px-space-xl py-space-xl">
        <div className="flex flex-col gap-space-md">
          <div className="flex items-center gap-space-md">
            <span className="flex h-10 w-10 items-center justify-center rounded border border-outline-variant bg-surface-container-low">
              <MaterialIcon name={icon} className="text-[20px] text-on-surface-variant" />
            </span>
            <span className="font-mono text-label-sm tabular text-on-surface-variant">{code}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">{title}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">{description}</p>
          <div className="flex flex-wrap items-center gap-space-sm pt-space-xs">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function ForbiddenPage({ requiredRoles, actualRole }: { requiredRoles?: Role[]; actualRole?: Role }) {
  return (
    <ErrorShell
      code="403"
      icon="lock"
      title="Access denied"
      description={
        requiredRoles && requiredRoles.length > 0
          ? `This area is restricted to ${requiredRoles.join(' / ')} accounts.${
              actualRole ? ` You are signed in as ${actualRole}.` : ''
            } Authorisation is enforced by the API — no client-side change can grant access.`
          : 'Your account does not have permission to view this page.'
      }
    >
      <Link to="/">
        <Button variant="secondary" icon="arrow_back">
          Back to safety
        </Button>
      </Link>
    </ErrorShell>
  );
}

export function NotFoundPage() {
  return (
    <ErrorShell
      code="404"
      icon="search_off"
      title="Page not found"
      description="That route does not exist in Stake It. It may have been renamed, or the link may be out of date."
    >
      <Link to="/">
        <Button icon="home">Go to dashboard</Button>
      </Link>
    </ErrorShell>
  );
}

/**
 * Router error element. Distinguishes a thrown `Response` (404 on a data route)
 * from a genuine render failure so the message stays accurate.
 */
/**
 * Catch-all route for the **declarative** router.
 *
 * `RouteErrorPage` calls `useRouteError()`, which only exists inside a data
 * router. Mounting it on `path="*"` under `BrowserRouter` threw
 * "useRouteError must be used within a data router" and the error boundary then
 * showed that message instead of a 404 — for any unknown URL, including an API
 * path that Vite's SPA fallback hands to the client.
 */
export function NotFoundRoutePage() {
  return <NotFoundPage />;
}

export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <NotFoundPage />;
    if (error.status === 403) return <ForbiddenPage />;
    return (
      <ErrorShell
        code={String(error.status)}
        icon="report"
        title={error.statusText || 'Request failed'}
        description={typeof error.data === 'string' ? error.data : 'The request could not be completed.'}
      >
        <Button variant="secondary" onClick={() => navigate(-1)} icon="arrow_back">
          Go back
        </Button>
      </ErrorShell>
    );
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

  return (
    <ErrorShell
      code="500"
      icon="report"
      title="Something went wrong"
      description="The interface hit an unexpected error. Your points and progress are stored server-side and are unaffected."
    >
      <Button variant="secondary" onClick={() => window.location.reload()} icon="refresh">
        Reload
      </Button>
      <pre className="mt-space-sm w-full overflow-auto rounded border border-outline-variant bg-surface-container-low p-space-md font-mono text-[12px] text-on-surface-variant">
        {message}
      </pre>
    </ErrorShell>
  );
}
