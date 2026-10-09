import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Chip, Divider, MaterialIcon, PointsBadge, ProgressBar, StatusPill } from '../ui/core';
import { MetricRow } from '../ui/data';
import { formatCountdown, formatDate, formatPercent, formatPoints, formatRelative, statusLabel, TRANSACTION_LABELS } from '../../utils/format';
import type { Pacing, WalletTransaction } from '../../types/api';

/* -------------------------------------------------------------------------- */
/* Risk                                                                        */
/* -------------------------------------------------------------------------- */

export function riskTone(riskLevel: string | undefined): 'neutral' | 'earned' | 'risk' | 'stake' {
  switch (riskLevel) {
    case 'AT_RISK':
    case 'GRACE_PERIOD':
    case 'FAILED':
      return 'risk';
    case 'COMPLETED':
      return 'earned';
    case 'ON_TRACK':
      return 'earned';
    case 'STEADY':
      return 'stake';
    default:
      return 'neutral';
  }
}

/** Pacing block shown on dashboard rows: expected vs actual, deadline, stake. */
export function PacingPanel({ pacing, className }: { pacing: Pacing; className?: string }) {
  const tone = pacing.isAtRisk ? 'risk' : pacing.gap > 0 ? 'stake' : 'success';

  return (
    <div className={cn('flex flex-col gap-space-xs', className)}>
      <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
        <span className={pacing.isAtRisk ? 'font-medium text-error' : ''}>{pacing.isAtRisk ? 'Pacing Behind' : 'Progress'}</span>
        <span className={cn('metric font-medium', pacing.isAtRisk ? 'text-error' : 'text-on-surface')}>
          {formatPercent(pacing.actualProgressPercent)}
        </span>
      </div>
      <ProgressBar value={pacing.actualProgressPercent} tone={tone === 'risk' ? 'risk' : tone === 'stake' ? 'primary' : 'success'} />
      <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
        <span>Expected {formatPercent(pacing.expectedProgressPercent)}</span>
        <span className={pacing.gap > 0 ? 'text-error' : 'text-secondary'}>
          {pacing.gap > 0 ? `${formatPercent(pacing.gap)} behind` : 'On schedule'}
        </span>
      </div>
    </div>
  );
}

export function AtRiskBanner({
  title,
  code,
  progressPercent,
  expectedProgressPercent,
  gap,
  daysRemaining,
  lockedStake,
  enrollmentId,
}: {
  title: string;
  code: string;
  progressPercent: number;
  expectedProgressPercent: number;
  gap: number;
  daysRemaining: number;
  lockedStake: number;
  enrollmentId: string;
}) {
  return (
    <div className="surface-card flex flex-col gap-space-md border-error/30 bg-error-container/10 px-space-lg py-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-space-sm">
            <span className="font-mono text-label-xs text-on-surface-variant">{code}</span>
            <StatusPill label="At Risk" tone="risk" />
          </div>
          <h3 className="font-headline-sm text-headline-sm text-on-surface">{title}</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            You are <span className="font-mono text-error">{formatPercent(gap)}</span> behind expected progress with{' '}
            <span className="font-mono text-error">{daysRemaining} day(s)</span> left.
          </p>
        </div>
        <div className="flex items-center gap-space-lg">
          <div className="flex flex-col text-right">
            <span className="font-label-sm text-label-sm text-error">{daysRemaining} days left</span>
            <span className="font-label-xs text-label-xs text-error">Risk: {formatPoints(lockedStake, { suffix: false })} pts</span>
          </div>
          <Link
            to={`/learn/${enrollmentId}`}
            className="inline-flex items-center gap-1 font-label-sm text-label-sm font-medium text-error transition-transform hover:translate-x-0.5"
          >
            Resume
            <MaterialIcon name="arrow_forward" className="text-[16px]" />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-space-md">
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Actual</span>
          <ProgressBar value={progressPercent} tone="risk" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Expected</span>
          <ProgressBar value={expectedProgressPercent} tone="muted" />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stake / reward / deadline                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The three-way accountability summary: what is at stake, what can be earned,
 * and when the deadline lands. Mirrors the enrollment and course screens.
 */
export function StakeRewardPanel({
  baseStake,
  completionReward,
  commitmentStake = 0,
  commitmentBonus = 0,
  performanceBonus = 0,
  performanceThreshold,
  potentialTotal,
  className,
}: {
  baseStake: number;
  completionReward: number;
  commitmentStake?: number;
  commitmentBonus?: number;
  performanceBonus?: number;
  performanceThreshold?: number;
  potentialTotal?: number;
  className?: string;
}) {
  const total =
    potentialTotal ?? baseStake + completionReward + commitmentStake + commitmentBonus + performanceBonus;

  return (
    <div className={cn('surface-card', className)}>
      <div className="flex items-center justify-between px-space-lg py-space-md">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Stake &amp; rewards</h2>
        <Chip tone="earned" icon="shield">
          Escrow protected
        </Chip>
      </div>
      <Divider />
      <div className="grid grid-cols-2 gap-space-lg px-space-lg py-space-md md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Base stake</span>
          <span className="font-headline-md text-headline-md tabular text-on-surface">{formatPoints(baseStake, { suffix: false })}</span>
          <span className="font-label-xs text-label-xs text-on-surface-variant">Committed at enrolment</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Completion reward</span>
          <span className="font-headline-md text-headline-md tabular text-secondary">
            +{formatPoints(completionReward, { suffix: false })}
          </span>
          <span className="font-label-xs text-label-xs text-on-surface-variant">On verified completion</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Commitment bonus</span>
          <span className="font-headline-md text-headline-md tabular text-secondary">
            +{formatPoints(commitmentBonus, { suffix: false })}
          </span>
          <span className="font-label-xs text-label-xs text-on-surface-variant">Optional accelerated deadline</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Performance bonus</span>
          <span className="font-headline-md text-headline-md tabular text-secondary">
            +{formatPoints(performanceBonus, { suffix: false })}
          </span>
          <span className="font-label-xs text-label-xs text-on-surface-variant">
            {performanceThreshold !== undefined ? `Final score ≥ ${performanceThreshold}%` : 'Score based'}
          </span>
        </div>
      </div>
      <Divider />
      <div className="flex items-center justify-between bg-surface-container-low px-space-lg py-space-md">
        <div className="flex items-center gap-space-sm">
          <MaterialIcon name="savings" className="text-primary-container" />
          <span className="font-label-md text-label-md text-on-surface">Total learner return cap</span>
        </div>
        <div className="flex items-center gap-space-md">
          <span className="font-headline-sm text-headline-sm tabular text-on-surface">
            {formatPoints(total, { suffix: false })}
          </span>
          {baseStake > 0 ? (
            <Chip tone="earned">+{Math.round(((total - baseStake) / baseStake) * 100)}% effective recovery</Chip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DeadlinePanel({
  startedAt,
  normalDeadline,
  acceleratedDeadline,
  graceDeadline,
  daysRemaining,
  acceleratedDaysRemaining,
  inGracePeriod,
  acceleratedDeadlineMissed,
  className,
}: {
  startedAt: string;
  normalDeadline: string;
  acceleratedDeadline?: string | null;
  graceDeadline: string;
  daysRemaining: number;
  acceleratedDaysRemaining?: number | null;
  inGracePeriod?: boolean;
  acceleratedDeadlineMissed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('surface-card', className)}>
      <div className="flex items-center justify-between px-space-lg py-space-md">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Deadlines &amp; timers</h2>
        <MaterialIcon name="schedule" className="text-on-surface-variant" />
      </div>
      <Divider />
      <div className="grid grid-cols-2 gap-space-lg px-space-lg py-space-md md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Enrolled</span>
          <span className="font-label-md text-label-md text-on-surface">{formatDate(startedAt)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Course deadline</span>
          <span className="font-label-md text-label-md text-on-surface">{formatDate(normalDeadline)}</span>
          <span className={cn('font-label-xs text-label-xs tabular', daysRemaining <= 3 ? 'text-error' : 'text-on-surface-variant')}>
            {formatCountdown(normalDeadline)}
          </span>
        </div>
        {acceleratedDeadline ? (
          <div className="flex flex-col gap-1">
            <span className="micro-label text-on-surface-variant">Your accelerated deadline</span>
            <span className={cn('font-label-md text-label-md', acceleratedDeadlineMissed ? 'text-error' : 'text-on-surface')}>
              {formatDate(acceleratedDeadline)}
            </span>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              {acceleratedDeadlineMissed
                ? 'Missed — bonus forgone, course active'
                : `${acceleratedDaysRemaining ?? 0} day(s) left`}
            </span>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Grace period ends</span>
          <span className={cn('font-label-md text-label-md', inGracePeriod ? 'text-error' : 'text-on-surface')}>
            {formatDate(graceDeadline)}
          </span>
          {inGracePeriod ? (
            <span className="font-label-xs text-label-xs text-error">Final window before forfeiture</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Wallet                                                                      */
/* -------------------------------------------------------------------------- */

export function WalletBalanceCard({
  availableBalance,
  lockedBalance,
  lifetimeEarned,
  lifetimeForfeited,
  activeCommitments,
  className,
}: {
  availableBalance: number;
  lockedBalance: number;
  lifetimeEarned: number;
  lifetimeForfeited: number;
  activeCommitments?: number;
  className?: string;
}) {
  return (
    <div className={cn('surface-card', className)}>
      <div className="flex flex-col gap-space-lg px-space-lg py-space-lg md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="micro-label text-on-surface-variant">Available balance</span>
          <div className="flex items-baseline gap-space-sm">
            <span className="font-headline-xl text-headline-xl tabular tracking-tight text-on-surface">
              {availableBalance.toLocaleString('en-US')}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">pts</span>
          </div>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {lockedBalance > 0
              ? `${lockedBalance.toLocaleString('en-US')} pts locked in active stakes`
              : 'No points currently locked'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-space-lg">
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Locked</span>
            <span className="font-headline-sm text-headline-sm tabular text-primary-container">
              {lockedBalance.toLocaleString('en-US')}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Lifetime earned</span>
            <span className="font-headline-sm text-headline-sm tabular text-secondary">
              {lifetimeEarned.toLocaleString('en-US')}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Forfeited</span>
            <span className={cn('font-headline-sm text-headline-sm tabular', lifetimeForfeited > 0 ? 'text-error' : 'text-on-surface-variant')}>
              {lifetimeForfeited.toLocaleString('en-US')}
            </span>
          </div>
        </div>
      </div>
      {activeCommitments !== undefined && activeCommitments > 0 ? (
        <div className="border-t border-outline-variant bg-surface-container-low px-space-lg py-space-sm">
          <span className="font-label-xs text-label-xs text-on-surface-variant">
            {activeCommitments} accelerated commitment{activeCommitments === 1 ? '' : 's'} in flight
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function TransactionList({
  transactions,
  emptyLabel = 'No transactions yet',
  className,
}: {
  transactions: WalletTransaction[];
  emptyLabel?: string;
  className?: string;
}) {
  if (transactions.length === 0) {
    return (
      <p className={cn('px-space-lg py-space-lg font-body-sm text-body-sm text-on-surface-variant', className)}>{emptyLabel}</p>
    );
  }

  return (
    <ul className={cn('divide-y divide-outline-variant', className)}>
      {transactions.map((transaction) => {
        const positive = transaction.amount > 0;
        return (
          <li key={transaction.id} className="flex items-start justify-between gap-space-lg px-space-lg py-space-sm hover:bg-surface-container-low">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-label-md text-label-md text-on-surface">
                {TRANSACTION_LABELS[transaction.type] ?? statusLabel(transaction.type)}
              </span>
              <span className="truncate font-body-sm text-body-sm text-on-surface-variant">{transaction.description}</span>
              <span className="font-label-xs text-label-xs text-on-surface-variant">{formatRelative(transaction.createdAt)}</span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className={cn('font-mono text-label-md tabular', positive ? 'text-secondary' : 'text-error')}>
                {positive ? '+' : '−'}
                {Math.abs(transaction.amount).toLocaleString('en-US')} pts
              </span>
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                balance {transaction.balanceAfter.toLocaleString('en-US')}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AchievementsGrid({
  achievements,
}: {
  achievements: {
    certificates: number;
    bestScore: number;
    perfectScores: number;
    performanceBonusesEarned: number;
    commitmentBonusesEarned: number;
  };
}) {
  const items = [
    { label: 'Courses completed', value: achievements.certificates, icon: 'workspace_premium' },
    { label: 'Best final score', value: formatPercent(achievements.bestScore), icon: 'trending_up' },
    { label: 'Scores ≥ 90%', value: achievements.perfectScores, icon: 'military_tech' },
    { label: 'Performance bonuses', value: achievements.performanceBonusesEarned, icon: 'bolt' },
    { label: 'Commitment bonuses', value: achievements.commitmentBonusesEarned, icon: 'timer' },
  ];

  return (
    <div className="grid grid-cols-2 gap-space-md md:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="surface-card flex flex-col gap-space-sm px-space-md py-space-md">
          <div className="flex items-center justify-between">
            <span className="micro-label text-on-surface-variant">{item.label}</span>
            <MaterialIcon name={item.icon} className="text-[16px] text-on-surface-variant" />
          </div>
          <span className="font-headline-md text-headline-md tabular text-on-surface">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Locked content                                                              */
/* -------------------------------------------------------------------------- */

export function LockedNotice({ reason, className }: { reason?: string | null; className?: string }) {
  return (
    <div className={cn('flex items-start gap-space-sm rounded border border-outline-variant bg-surface px-space-md py-space-sm', className)}>
      <MaterialIcon name="lock" className="mt-0.5 text-[16px] text-[#94A3B8]" />
      <div className="flex flex-col">
        <span className="font-label-sm text-label-sm text-[#94A3B8]">Locked</span>
        <span className="font-body-sm text-body-sm text-on-surface-variant">
          {reason ?? 'Complete the previous required item to unlock this content.'}
        </span>
      </div>
    </div>
  );
}

export function DeadlineChip({ deadline, daysRemaining, risk }: { deadline: string; daysRemaining: number; risk?: boolean }) {
  return (
    <div className="flex flex-col text-right">
      <span className={cn('font-label-md text-label-md', risk ? 'font-semibold text-error' : 'text-on-surface')}>
        {daysRemaining > 0 ? `${daysRemaining} days left` : 'Due now'}
      </span>
      <span className="font-label-xs text-label-xs text-on-surface-variant">Auto-forfeit {formatDate(deadline)}</span>
    </div>
  );
}

export function StakeLine({
  label,
  amount,
  tone = 'default',
  sub,
}: {
  label: string;
  amount: number;
  tone?: 'default' | 'positive' | 'negative' | 'neutral';
  sub?: string;
}) {
  return <MetricRow label={label} value={<PointsBadge amount={amount} signed />} tone={tone === 'neutral' ? 'muted' : tone} sub={sub} />;
}
