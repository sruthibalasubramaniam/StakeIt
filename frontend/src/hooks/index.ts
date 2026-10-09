import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api';
import { useToast } from '../context/ToastContext';

/* -------------------------------------------------------------------------- */
/* Data fetching                                                               */
/* -------------------------------------------------------------------------- */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setData: (value: T | null) => void;
}

/**
 * Minimal data-fetching hook: no cache layer to reason about, explicit loading
 * and error states, and a `refetch` for after mutations.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[] = [], options: { enabled?: boolean } = {}): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (mounted.current) setData(result);
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, error, refetch: run, setData };
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export interface AsyncAction<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | null>;
  pending: boolean;
  error: string | null;
}

/**
 * Wraps a mutation with pending/error state and toast reporting, so no button
 * in the app has to re-implement that triad.
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  options: { successMessage?: string | ((result: TResult) => string); rethrow?: boolean } = {},
): AsyncAction<TArgs, TResult> {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      setError(null);
      try {
        const result = await action(...args);
        if (options.successMessage) {
          toast.success(
            typeof options.successMessage === 'function' ? options.successMessage(result) : options.successMessage,
          );
        }
        return result;
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        toast.error('Action failed', message);
        if (options.rethrow) throw caught;
        return null;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, options.successMessage, options.rethrow, toast],
  );

  return { run, pending, error };
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

export function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Live "time remaining" string, refreshed once a minute. */
export function useCountdown(deadline: string | Date | null | undefined): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  void tick;

  if (!deadline) return 0;
  const target = typeof deadline === 'string' ? new Date(deadline) : deadline;
  return Math.max(0, target.getTime() - Date.now());
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · Stake It` : 'Stake It';
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** Tracks unsaved changes so the builder can warn before navigating away. */
export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
