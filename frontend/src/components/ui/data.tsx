import { useEffect, type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Button, Divider, MaterialIcon, Spinner } from './core';

/* -------------------------------------------------------------------------- */
/* Cards & headers                                                             */
/* -------------------------------------------------------------------------- */

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('surface-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-space-lg px-space-lg py-space-md', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
        {subtitle ? <p className="font-body-sm text-body-sm text-on-surface-variant">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-space-sm">
        {meta}
        {action}
      </div>
    </div>
  );
}

/** Section eyebrow (optional) + heading. */
export function SectionHeader({
  eyebrow,
  title,
  meta,
  action,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col pb-space-lg mb-space-lg md:flex-row md:items-end md:justify-between', className)}>
      <div className="flex flex-col gap-space-xs">
        {eyebrow ? (
          <div className="flex items-center gap-space-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
            <span className="micro-label text-on-surface-variant">{eyebrow}</span>
          </div>
        ) : null}
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface md:text-headline-xl md:font-headline-xl">
          {title}
        </h1>
      </div>
      {(meta || action) && (
        <div className="mt-space-md flex items-center gap-space-lg md:mt-0">
          {meta}
          {action}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: string;
  tone?: 'neutral' | 'primary' | 'success' | 'risk';
  className?: string;
}) {
  const valueTone: Record<string, string> = {
    neutral: 'text-on-surface',
    primary: 'text-primary-container',
    success: 'text-secondary',
    risk: 'text-error',
  };

  return (
    <div className={cn('surface-card flex flex-col gap-space-sm px-space-lg py-space-md', className)}>
      <div className="flex items-center justify-between">
        <span className="micro-label text-on-surface-variant">{label}</span>
        {icon ? <MaterialIcon name={icon} className="text-[16px] text-on-surface-variant" /> : null}
      </div>
      <span className={cn('font-headline-lg text-headline-lg tabular tracking-tight', valueTone[tone])}>{value}</span>
      {hint ? <span className="font-body-sm text-body-sm text-on-surface-variant">{hint}</span> : null}
    </div>
  );
}

/** Label / value row used in settlement receipts and stake summaries. */
export function MetricRow({
  label,
  value,
  tone = 'default',
  sub,
  strong = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
  sub?: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  const toneClass: Record<string, string> = {
    default: 'text-on-surface',
    positive: 'text-secondary',
    negative: 'text-error',
    muted: 'text-on-surface-variant',
  };

  return (
    <div className={cn('flex items-baseline justify-between gap-space-lg py-space-sm', className)}>
      <div className="flex flex-col">
        <span className={cn('font-body-md text-body-md', strong ? 'text-on-surface' : 'text-on-surface-variant')}>{label}</span>
        {sub ? <span className="font-label-xs text-label-xs text-on-surface-variant">{sub}</span> : null}
      </div>
      <span className={cn('font-mono tabular', strong ? 'font-headline-sm text-headline-sm' : 'font-label-md text-label-md', toneClass[tone])}>
        {value}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

export function DataTable<T>({
  columns,
  rows,
  keyFor,
  empty,
  loading = false,
  onRowClick,
  className,
}: {
  columns: Array<{ key: string; header: ReactNode; align?: 'left' | 'right'; className?: string; render: (row: T) => ReactNode }>;
  rows: T[];
  keyFor: (row: T, index: number) => string;
  empty?: ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-space-sm px-space-lg py-space-xl text-on-surface-variant">
        <Spinner />
        <span className="font-body-sm text-body-sm">Loading…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="px-space-lg py-space-xl">{empty ?? <EmptyState title="Nothing here yet" />}</div>;
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-outline-variant bg-surface-container-low">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-space-lg py-space-sm micro-label text-on-surface-variant',
                  column.align === 'right' && 'text-right',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={keyFor(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-outline-variant transition-colors',
                onRowClick && 'cursor-pointer hover:bg-surface-container-low',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-space-lg py-space-md font-body-sm text-body-sm text-on-surface', column.align === 'right' && 'text-right', column.className)}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className={cn('flex items-center justify-between gap-space-md px-space-lg py-space-md', className)}>
      <span className="font-label-sm text-label-sm text-on-surface-variant">
        Page <span className="metric text-on-surface">{page}</span> of <span className="metric text-on-surface">{totalPages}</span>
        <span className="ml-2 opacity-70">({total.toLocaleString('en-US')} total)</span>
      </span>
      <div className="flex items-center gap-space-sm">
        <Button size="sm" variant="secondary" icon="chevron_left" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconRight="chevron_right"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback states                                                             */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  icon = 'inbox',
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-space-sm px-space-lg py-space-xl text-center', className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded border border-outline-variant bg-surface-container-low">
        <MaterialIcon name={icon} className="text-[20px] text-on-surface-variant" />
      </span>
      <h3 className="font-headline-sm text-headline-sm text-on-surface">{title}</h3>
      {description ? <p className="max-w-sm font-body-sm text-body-sm text-on-surface-variant">{description}</p> : null}
      {action ? <div className="mt-space-sm">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-space-sm" aria-busy="true" aria-live="polite">
      <span className="flex items-center gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
        <Spinner />
        {label}
      </span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 w-full animate-pulse rounded border border-outline-variant bg-surface-container-low" />
      ))}
    </div>
  );
}

export function ErrorBlock({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('surface-card flex flex-col gap-space-md border-error/30 px-space-lg py-space-lg', className)} role="alert">
      <div className="flex items-start gap-space-sm">
        <MaterialIcon name="report" className="mt-0.5 text-error" />
        <div className="flex flex-col">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">{title}</h3>
          {message ? <p className="font-body-sm text-body-sm text-on-surface-variant">{message}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <div>
          <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
  icon?: string;
  action?: ReactNode;
  className?: string;
}) {
  const tones: Record<string, { wrapper: string; icon: string; defaultIcon: string }> = {
    info: { wrapper: 'border-primary-fixed-dim bg-primary-fixed/40', icon: 'text-primary-container', defaultIcon: 'info' },
    success: { wrapper: 'border-secondary-fixed-dim bg-secondary-fixed/30', icon: 'text-secondary', defaultIcon: 'check_circle' },
    warning: { wrapper: 'border-tertiary-fixed-dim bg-tertiary-fixed/30', icon: 'text-tertiary-container', defaultIcon: 'warning' },
    error: { wrapper: 'border-error/30 bg-error-container/40', icon: 'text-error', defaultIcon: 'error' },
  };
  const tone_ = tones[tone]!;

  return (
    <div className={cn('flex items-start gap-space-sm rounded border px-space-md py-space-sm', tone_.wrapper, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <MaterialIcon name={icon ?? tone_.defaultIcon} className={cn('mt-0.5', tone_.icon)} />
      <div className="flex flex-1 flex-col gap-1">
        {title ? <p className="font-label-md text-label-md text-on-surface">{title}</p> : null}
        {children ? <div className="font-body-sm text-body-sm text-on-surface-variant">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal & tabs                                                                */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-space-md">
      {/* Flat scrim, no backdrop blur — matches the design system. */}
      <div className="absolute inset-0 bg-[#0F172A]/20" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex w-full flex-col rounded-xl border border-outline-variant bg-surface-container-lowest',
          'shadow-[0_4px_12px_rgba(15,23,42,0.05)]',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-space-lg px-space-lg py-space-md">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
            {description ? <p className="font-body-sm text-body-sm text-on-surface-variant">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="text-on-surface-variant hover:text-on-surface">
            <MaterialIcon name="close" />
          </button>
        </div>
        <Divider />
        <div className="max-h-[70vh] overflow-y-auto px-space-lg py-space-lg">{children}</div>
        {footer ? (
          <>
            <Divider />
            <div className="flex items-center justify-end gap-space-sm px-space-lg py-space-md">{footer}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-space-md border-b border-outline-variant', className)} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px border-b-2 pb-space-sm font-label-md text-label-md transition-colors',
              isActive
                ? 'border-primary text-on-surface'
                : 'border-transparent text-on-surface-variant hover:text-on-surface',
            )}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="ml-1 font-mono tabular opacity-70">({tab.count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Inline confirmation used for forfeit-style irreversible actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="font-body-md text-body-md text-on-surface-variant">{message}</p>
    </Modal>
  );
}
