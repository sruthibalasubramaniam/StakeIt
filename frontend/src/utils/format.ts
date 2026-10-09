/**
 * Formatting helpers. Every points value is rendered with tabular figures so
 * columns of numbers line up, matching the supplied design.
 */

export function formatPoints(value: number | null | undefined, options: { sign?: boolean; suffix?: boolean } = {}): string {
  const amount = Number(value ?? 0);
  const formatted = new Intl.NumberFormat('en-US').format(Math.abs(amount));
  const prefix = options.sign && amount !== 0 ? (amount > 0 ? '+' : '−') : amount < 0 ? '−' : '';
  return `${prefix}${formatted}${options.suffix === false ? '' : ' pts'}`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value ?? 0));
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
  return `${formatNumber(Number(value ?? 0), decimals)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString(
    'en-US',
    { hour: '2-digit', minute: '2-digit', hour12: false },
  )}`;
}

/** "8 days left" / "3 hours left" / "Deadline passed". */
export function formatCountdown(deadline: string | Date | null | undefined): string {
  if (!deadline) return 'No deadline';
  const target = typeof deadline === 'string' ? new Date(deadline) : deadline;
  const diffMs = target.getTime() - Date.now();

  if (diffMs <= 0) return 'Deadline passed';

  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;

  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} left`;

  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(date);
}

export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds ?? 0)));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** Human labels for the API enum values shown in the UI. */
export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  AT_RISK: 'At Risk',
  GRACE_PERIOD: 'Grace Period',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  ABANDONED: 'Abandoned',
  WITHDRAWN: 'Withdrawn',
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  LOCKED: 'Locked',
  RETURNED: 'Returned',
  FORFEITED: 'Forfeited',
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  ON_TRACK: 'On Track',
  STEADY: 'Steady',
};

export const TRANSACTION_LABELS: Record<string, string> = {
  SIGNUP_GRANT: 'Welcome grant',
  STAKE_LOCKED: 'Stake locked',
  STAKE_RETURNED: 'Stake returned',
  STAKE_FORFEITED: 'Stake forfeited',
  COURSE_REWARD: 'Course reward',
  COMMITMENT_BONUS: 'Commitment bonus',
  PERFORMANCE_BONUS: 'Performance bonus',
  RETRY_REWARD: 'Retry recovery reward',
  ADMIN_ADJUSTMENT: 'Administrator adjustment',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
