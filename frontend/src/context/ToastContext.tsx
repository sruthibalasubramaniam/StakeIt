import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../utils/cn';
import { MaterialIcon } from '../components/ui/core';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { border: string; icon: string; iconClass: string }> = {
  success: { border: 'border-l-secondary', icon: 'check_circle', iconClass: 'text-secondary' },
  error: { border: 'border-l-error', icon: 'error', iconClass: 'text-error' },
  warning: { border: 'border-l-tertiary-container', icon: 'warning', iconClass: 'text-tertiary-container' },
  info: { border: 'border-l-primary-container', icon: 'info', iconClass: 'text-primary-container' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      // Errors stay a little longer because they usually need to be read.
      window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
      warning: (title, description) => push({ tone: 'warning', title, description }),
      dismiss,
    }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const tone = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'surface-card border-l-2 px-space-md py-space-sm',
                tone.border,
                'shadow-[0_4px_12px_rgba(15,23,42,0.05)]',
              )}
            >
              <div className="flex items-start gap-space-sm">
                <MaterialIcon name={tone.icon} className={cn('mt-0.5 text-[18px]', tone.iconClass)} />
                <div className="flex-1">
                  <p className="font-label-md text-label-md text-on-surface">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{toast.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="text-on-surface-variant hover:text-on-surface"
                  aria-label="Dismiss notification"
                >
                  <MaterialIcon name="close" className="text-[16px]" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}
