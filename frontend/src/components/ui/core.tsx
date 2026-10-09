import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

/* -------------------------------------------------------------------------- */
/* Icon                                                                        */
/* -------------------------------------------------------------------------- */

export function MaterialIcon({
  name,
  className,
  filled = false,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('material-symbols-outlined text-[18px]', className)}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Filled indigo CTA — hover deepens to `primary`, active to `primary-fixed-dim`.
  primary: 'bg-primary-container text-on-primary hover:bg-primary active:bg-on-primary-fixed-variant border border-transparent',
  secondary: 'bg-surface-container-lowest text-on-surface border border-outline-variant hover:bg-surface-container-low hover:border-outline',
  ghost: 'bg-transparent text-on-surface-variant border border-transparent hover:bg-surface-container-low hover:text-on-surface',
  destructive: 'bg-error text-on-error border border-transparent hover:bg-on-error-container',
  link: 'bg-transparent text-primary border border-transparent hover:underline p-0 h-auto',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // Standard control height is 36px (compact) with 12px horizontal padding.
  sm: 'h-8 px-space-md text-label-sm [&_span.material-symbols-outlined]:text-[16px]',
  md: 'h-9 px-space-md text-label-md [&_span.material-symbols-outlined]:text-[18px]',
  lg: 'h-11 px-space-lg text-label-md [&_span.material-symbols-outlined]:text-[20px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading = false, block = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-space-xs rounded font-label-md transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        variant !== 'link' && BUTTON_SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="text-[16px]" /> : icon ? <MaterialIcon name={icon} /> : null}
      {children}
      {iconRight && !loading ? <MaterialIcon name={iconRight} /> : null}
    </button>
  );
});

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded border border-outline-variant bg-surface-container-lowest',
        'text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      <MaterialIcon name={icon} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips & badges                                                              */
/* -------------------------------------------------------------------------- */

export type ChipTone = 'neutral' | 'stake' | 'earned' | 'risk' | 'locked' | 'info';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-surface-container-low border-outline-variant text-on-surface-variant',
  stake: 'bg-primary-fixed border-primary-fixed-dim text-primary-container',
  earned: 'bg-secondary-fixed/40 border-secondary-fixed-dim text-secondary',
  risk: 'bg-error-container/40 border-error/30 text-error',
  locked: 'bg-surface border-outline-variant text-[#94A3B8]',
  info: 'bg-surface-container border-outline-variant text-on-surface-variant',
};

export function Chip({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  icon?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-space-sm py-0.5 micro-label',
        CHIP_TONES[tone],
        className,
      )}
    >
      {icon ? <MaterialIcon name={icon} className="text-[13px]" /> : null}
      {children}
    </span>
  );
}

/** Points/stake pill — the only place a fully rounded shape is allowed. */
export function PointsBadge({ amount, signed = false, className }: { amount: number; signed?: boolean; className?: string }) {
  const positive = amount > 0;
  const negative = amount < 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-space-sm py-0.5 font-mono text-label-xs tabular',
        signed && positive && 'border-secondary-fixed-dim bg-secondary-fixed/40 text-secondary',
        signed && negative && 'border-error/30 bg-error-container/40 text-error',
        !signed && 'border-primary-fixed-dim bg-primary-fixed text-primary-container',
        className,
      )}
    >
      {signed ? (positive ? '+' : negative ? '−' : '') : null}
      {Math.abs(amount).toLocaleString('en-US')}
      <span className="opacity-70">pts</span>
    </span>
  );
}

/** Colour-coded attempt / risk status used across the dashboards. */
export function StatusPill({ label, tone, dot = true }: { label: string; tone: ChipTone; dot?: boolean }) {
  const dotColor: Record<ChipTone, string> = {
    neutral: 'bg-on-surface-variant',
    stake: 'bg-primary-container',
    earned: 'bg-secondary',
    risk: 'bg-error',
    locked: 'bg-[#94A3B8]',
    info: 'bg-on-surface-variant',
  };
  return (
    <span className={cn('inline-flex items-center gap-space-xs micro-label', tone === 'risk' ? 'text-error' : 'text-on-surface-variant')}>
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dotColor[tone])} /> : null}
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

export function Divider({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-surface-container', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 2-3px rectangular progress track. `tone` communicates state rather than
 * decorating: indigo in progress, green goal met, red at risk.
 */
export function ProgressBar({
  value,
  tone = 'primary',
  className,
  label,
}: {
  value: number;
  tone?: 'primary' | 'success' | 'risk' | 'muted';
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const fill: Record<string, string> = {
    primary: 'bg-primary-container',
    success: 'bg-secondary',
    risk: 'bg-error',
    muted: 'bg-outline-variant',
  };

  return (
    <div
      className={cn('progress-track', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className={cn('progress-fill', fill[tone])} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function LabeledProgress({
  value,
  label = 'Progress',
  tone = 'primary',
  right,
  className,
}: {
  value: number;
  label?: string;
  tone?: 'primary' | 'success' | 'risk' | 'muted';
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="mb-1.5 flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
        <span>{label}</span>
        {right ?? <span className="metric font-medium text-on-surface">{Math.round(value)}%</span>}
      </div>
      <ProgressBar value={value} tone={tone} label={label} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function LockIcon({ className }: { className?: string }) {
  return <MaterialIcon name="lock" className={cn('text-[14px] text-[#94A3B8]', className)} />;
}

export function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const label =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?';

  if (url) {
    return <img src={url} alt={name} className={cn('h-7 w-7 rounded-full border border-outline-variant object-cover', className)} />;
  }

  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-container font-label-xs text-label-xs text-on-primary',
        className,
      )}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
      {children}
    </kbd>
  );
}

export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function SurfaceSection({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cn('surface-card', className)} {...rest}>
      {children}
    </section>
  );
}
