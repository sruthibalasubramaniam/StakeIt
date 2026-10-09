import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Last line of defence: an unhandled render error shows a readable page
 * instead of a blank screen. Route-level errors are handled by the router's
 * error element; this catches everything else.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[Stake It] Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-margin-mobile md:p-margin">
        <div className="surface-card w-full max-w-lg px-space-xl py-space-xl">
          <div className="flex flex-col gap-space-md">
            <span className="flex h-10 w-10 items-center justify-center rounded border border-error/30 bg-error-container/40">
              <span className="material-symbols-outlined text-error">report</span>
            </span>
            <h1 className="font-headline-md text-headline-md text-on-surface">Something went wrong</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              The interface hit an unexpected error. Reloading usually clears it — your points and course progress are stored
              server-side and are unaffected.
            </p>
            <pre className="max-h-40 overflow-auto rounded border border-outline-variant bg-surface-container-low p-space-md font-mono text-[12px] text-on-surface-variant">
              {this.state.error.message}
            </pre>
            <div className="flex gap-space-sm">
              <button
                type="button"
                onClick={() => window.location.assign('/')}
                className="inline-flex h-9 items-center rounded bg-primary-container px-space-md font-label-md text-on-primary hover:bg-primary"
              >
                Back to dashboard
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex h-9 items-center rounded border border-outline-variant bg-surface-container-lowest px-space-md font-label-md text-on-surface hover:bg-surface-container-low"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
