import { cn } from '../../utils/cn';
import { EmptyState } from '../ui/data';

/**
 * Hand-rolled SVG charts.
 *
 * The supplied design has no chart library and no decorative fills, so these are
 * flat bars in the established palette: indigo for "in progress", green for
 * "achieved", red for "at risk", grey for context.
 */

export interface BarDatum {
  label: string;
  value: number;
  tone?: 'primary' | 'success' | 'risk' | 'muted';
  hint?: string;
}

/** Horizontal bars — used for module funnels and rating distributions. */
export function BarList({
  data,
  max,
  unit = '',
  className,
  emptyLabel = 'No data yet',
}: {
  data: BarDatum[];
  max?: number;
  unit?: string;
  className?: string;
  emptyLabel?: string;
}) {
  if (data.length === 0) return <EmptyState title={emptyLabel} icon="bar_chart" />;

  const ceiling = max ?? Math.max(1, ...data.map((entry) => entry.value));

  return (
    <div className={cn('flex flex-col gap-space-sm', className)}>
      {data.map((entry) => {
        const percent = ceiling > 0 ? Math.min(100, (entry.value / ceiling) * 100) : 0;
        return (
          <div key={entry.label} className="flex items-center gap-space-md">
            <span className="w-40 shrink-0 truncate font-label-sm text-label-sm text-on-surface-variant" title={entry.label}>
              {entry.label}
            </span>
            <span className="h-2 flex-1 bg-surface-container-high">
              <span
                className={cn('block h-full', {
                  'bg-[#4338CA]': (entry.tone ?? 'primary') === 'primary',
                  'bg-[#006d30]': entry.tone === 'success',
                  'bg-[#ba1a1a]': entry.tone === 'risk',
                  'bg-[#c7c4d7]': entry.tone === 'muted',
                })}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-label-sm tabular text-on-surface">
              {entry.value.toLocaleString('en-US')}
              {unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical bars for short series (e.g. per-course averages). */
export function ColumnChart({
  data,
  height = 160,
  unit = '',
  className,
}: {
  data: BarDatum[];
  height?: number;
  unit?: string;
  className?: string;
}) {
  if (data.length === 0) return <EmptyState title="No data yet" icon="bar_chart" />;

  const ceiling = Math.max(1, ...data.map((entry) => entry.value));

  return (
    <div className={cn('flex items-end gap-space-md', className)} style={{ height }}>
      {data.map((entry) => {
        const barHeight = Math.max(2, (entry.value / ceiling) * (height - 28));
        return (
          <div key={entry.label} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="font-mono text-label-xs tabular text-on-surface">
              {entry.value.toLocaleString('en-US')}
              {unit}
            </span>
            <span
              className={cn('w-full max-w-[48px]', {
                'bg-[#4338CA]': (entry.tone ?? 'primary') === 'primary',
                'bg-[#006d30]': entry.tone === 'success',
                'bg-[#ba1a1a]': entry.tone === 'risk',
                'bg-[#c7c4d7]': entry.tone === 'muted',
              })}
              style={{ height: barHeight }}
              title={entry.hint}
            />
            <span className="w-full truncate text-center font-label-xs text-label-xs text-on-surface-variant" title={entry.label}>
              {entry.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Star-distribution chart. Uses an SVG star path so the shape renders
 * identically without pulling in an icon dependency.
 */
export function RatingDistribution({
  distribution,
  className,
}: {
  distribution: Array<{ rating: number; count: number }>;
  className?: string;
}) {
  const total = distribution.reduce((sum, entry) => sum + entry.count, 0);
  const max = Math.max(1, ...distribution.map((entry) => entry.count));

  if (total === 0) return <EmptyState title="No ratings yet" description="Ratings appear once learners complete the course." icon="star" />;

  const sorted = [...distribution].sort((a, b) => b.rating - a.rating);

  return (
    <div className={cn('flex flex-col gap-space-sm', className)}>
      {sorted.map((entry) => (
        <div key={entry.rating} className="flex items-center gap-space-md">
          <span className="flex w-10 shrink-0 items-center gap-0.5 font-mono text-label-sm tabular text-on-surface-variant">
            {entry.rating}
            <svg viewBox="0 0 20 20" className="h-3 w-3 fill-[#4338CA]" aria-hidden="true">
              <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
            </svg>
          </span>
          <span className="h-2 flex-1 bg-surface-container-high">
            <span
              className="block h-full bg-[#4338CA]"
              style={{ width: `${total > 0 ? (entry.count / max) * 100 : 0}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-label-xs tabular text-on-surface-variant">
            {entry.count} ({total > 0 ? Math.round((entry.count / total) * 100) : 0}%)
          </span>
        </div>
      ))}
    </div>
  );
}

/** Score gauge used for averages; a single flat bar with a threshold marker. */
export function ScoreGauge({
  value,
  threshold,
  label,
  className,
}: {
  value: number;
  threshold?: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('flex flex-col gap-space-sm', className)}>
      <div className="flex items-end justify-between">
        {label ? <span className="micro-label text-on-surface-variant">{label}</span> : <span />}
        <span className="font-headline-md text-headline-md tabular text-on-surface">{clamped.toFixed(1)}%</span>
      </div>
      <div className="relative h-2 w-full bg-surface-container-high">
        <div
          className={cn('h-full', threshold !== undefined && clamped < threshold ? 'bg-[#ba1a1a]' : 'bg-[#006d30]')}
          style={{ width: `${clamped}%` }}
        />
        {threshold !== undefined ? (
          <span
            className="absolute top-[-2px] h-3 w-[2px] bg-[#131b2e]"
            style={{ left: `${Math.min(100, threshold)}%` }}
            title={`Threshold ${threshold}%`}
          />
        ) : null}
      </div>
      {threshold !== undefined ? (
        <span className="font-label-xs text-label-xs text-on-surface-variant">Threshold {threshold}%</span>
      ) : null}
    </div>
  );
}

/** Reputation tier ladder: shows which tiers are met and what is missing. */
export function TierLadder({
  progress,
  className,
}: {
  progress: Array<{ tier: string; eligible: boolean; missing: string[] }>;
  className?: string;
}) {
  const order = ['GOLD', 'SILVER', 'BRONZE'];

  return (
    <div className={cn('flex flex-col gap-space-sm', className)}>
      {order.map((tier) => {
        const entry = progress.find((item) => item.tier === tier);
        const eligible = entry?.eligible ?? false;
        return (
          <div
            key={tier}
            className={cn(
              'flex items-start justify-between gap-space-md rounded border px-space-md py-space-sm',
              eligible ? 'border-secondary-fixed-dim bg-secondary-fixed/25' : 'border-outline-variant bg-surface-container-lowest',
            )}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-label-md text-label-md text-on-surface">{tier}</span>
              {!eligible && entry && entry.missing.length > 0 ? (
                <span className="font-label-xs text-label-xs text-on-surface-variant">{entry.missing.join(' · ')}</span>
              ) : null}
            </div>
            <span className={cn('font-label-xs text-label-xs', eligible ? 'text-secondary' : 'text-on-surface-variant')}>
              {eligible ? 'Eligible' : 'Not yet'}
            </span>
          </div>
        );
      })}
      <p className="font-label-xs text-label-xs text-on-surface-variant">
        Reputation requires a minimum sample size — a small number of perfect completions never awards a high tier.
      </p>
    </div>
  );
}
