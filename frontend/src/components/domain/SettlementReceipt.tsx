import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Button, Chip, Divider, MaterialIcon, PointsBadge, ProgressBar } from '../ui/core';
import { MetricRow } from '../ui/data';
import { formatDateTime, formatPercent, formatPoints } from '../../utils/format';
import type { SettlementSummary } from '../../types/api';

/**
 * Completion / settlement receipt — the `course_completion_summary` design.
 *
 * Every figure comes from the backend settlement payload; nothing is
 * recomputed in the browser. The audit reference is produced server-side so a
 * receipt can be independently re-verified; the settlement hash ships in the
 * same payload but is deliberately not rendered.
 */
export function SettlementReceipt({ settlement, className }: { settlement: SettlementSummary; className?: string }) {
  const { breakdown, thresholds, lines } = settlement;
  const thresholdSatisfied = thresholds.cohortThresholdSatisfied;

  return (
    <div className={cn('surface-card mx-auto w-full max-w-xl', className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-space-md px-space-lg pt-space-lg">
        <div className="flex items-center gap-space-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          <span className="micro-label text-on-surface-variant">
            Audit ref · {settlement.auditReference}
          </span>
        </div>
        <Chip tone={settlement.status === 'COMPLETED' ? 'earned' : 'risk'}>{settlement.status.toLowerCase()}</Chip>
      </div>

      <div className="flex flex-col gap-space-lg px-space-lg py-space-lg">
        <div className="flex flex-col gap-space-xs">
          <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-secondary">
            <MaterialIcon name="check_circle" filled className="text-[16px]" />
            Course completed
          </span>
          <h1 className="font-headline-lg text-headline-lg leading-tight tracking-tight text-on-surface">
            {settlement.courseTitle}
          </h1>
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="text-on-surface-variant">Completion date</span>
            <span className="text-on-surface">{formatDateTime(settlement.completedAt)}</span>
          </div>
          {settlement.isRetry ? (
            <div className="flex items-center justify-between font-label-sm text-label-sm">
              <span className="text-on-surface-variant">Attempt</span>
              <span className="font-mono tabular text-on-surface">
                #{settlement.attemptNumber} (retry)
              </span>
            </div>
          ) : null}
        </div>

        {/* Cohort threshold band */}
        <div className="flex flex-col gap-space-sm rounded border border-outline-variant bg-surface-container-low px-space-md py-space-sm">
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="text-on-surface">Cohort threshold: {thresholds.cohortThreshold}%</span>
            <span className={thresholdSatisfied ? 'text-secondary' : 'text-error'}>
              Requirement {thresholdSatisfied ? 'satisfied' : 'not satisfied'}
            </span>
          </div>
          <ProgressBar value={breakdown.finalScore} tone={thresholdSatisfied ? 'success' : 'risk'} label="Final course score" />
        </div>

        {/* Performance breakdown */}
        <div className="flex flex-col">
          <span className="micro-label mb-space-xs text-on-surface-variant">Performance breakdown</span>
          <MetricRow label="Module score" value={formatPercent(breakdown.moduleScore, 1)} sub={`weighted ${breakdown.moduleWeight}%`} />
          <MetricRow
            label="Final test score"
            value={formatPercent(breakdown.finalTestScore, 1)}
            sub={`weighted ${breakdown.finalTestWeight}%`}
          />
          <MetricRow label="Final course score" value={formatPercent(breakdown.finalScore, 1)} strong />
          {thresholds.minFinalTestScore !== null ? (
            <MetricRow
              label="Minimum final test"
              value={formatPercent(thresholds.minFinalTestScore, 0)}
              tone={breakdown.finalTestScore >= thresholds.minFinalTestScore ? 'default' : 'negative'}
              sub={breakdown.finalTestScore >= thresholds.minFinalTestScore ? 'Requirement met' : 'Below required minimum'}
            />
          ) : null}
        </div>

        {/* Points & stakes settlement */}
        <div className="flex flex-col">
          <span className="micro-label mb-space-xs text-on-surface-variant">Points &amp; stakes settlement</span>
          {lines.length === 0 ? (
            <p className="py-space-sm font-body-sm text-body-sm text-on-surface-variant">
              No point movements were recorded for this settlement.
            </p>
          ) : (
            lines.map((line, index) => (
              <div key={`${line.transactionType}-${index}`} className="flex items-center justify-between gap-space-lg py-space-sm">
                <span className="flex items-center gap-1.5 font-body-md text-body-md text-on-surface-variant">
                  <MaterialIcon
                    name={line.transactionType === 'STAKE_RETURNED' ? 'undo' : 'add'}
                    className="text-[15px]"
                  />
                  {line.label}
                </span>
                <PointsBadge amount={line.amount} signed />
              </div>
            ))
          )}
        </div>

        <Divider />

        {/* Total */}
        <div className="flex items-end justify-between">
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Settlement total</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Credited to wallet ledger</span>
          </div>
          <span className={cn('font-headline-lg text-headline-lg tabular', settlement.totalCredited >= 0 ? 'text-secondary' : 'text-error')}>
            +{settlement.totalCredited.toLocaleString('en-US')} pts
          </span>
        </div>

        <div className="flex flex-col gap-space-sm rounded border border-outline-variant bg-surface-container-low px-space-md py-space-sm">
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="text-on-surface-variant">Account balance</span>
            <span className="font-mono tabular text-on-surface">
              {settlement.wallet.availableBalance.toLocaleString('en-US')} pts
            </span>
          </div>
          {settlement.wallet.lockedBalance > 0 ? (
            <div className="flex items-center justify-between font-label-sm text-label-sm">
              <span className="text-on-surface-variant">Still locked</span>
              <span className="font-mono tabular text-on-surface">
                {settlement.wallet.lockedBalance.toLocaleString('en-US')} pts
              </span>
            </div>
          ) : null}
        </div>

        {/* Award notes */}
        <div className="flex flex-col gap-space-xs">
          {settlement.commitmentMet === true ? (
            <span className="flex items-center gap-1.5 font-label-xs text-label-xs text-secondary">
              <MaterialIcon name="timer" className="text-[14px]" />
              Accelerated commitment met — commitment stake returned with a {formatPoints(settlement.commitmentBonusAwarded, { suffix: false })} point bonus.
            </span>
          ) : settlement.commitmentMet === false ? (
            <span className="flex items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
              <MaterialIcon name="timer_off" className="text-[14px]" />
              Accelerated deadline missed — the commitment bonus was forgone. The course itself still completed successfully.
            </span>
          ) : null}

          {settlement.performanceBonusEarned ? (
            <span className="flex items-center gap-1.5 font-label-xs text-label-xs text-secondary">
              <MaterialIcon name="bolt" className="text-[14px]" />
              Performance bonus awarded — {formatPercent(breakdown.finalScore, 1)} cleared the {thresholds.performanceThreshold}% threshold.
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
              <MaterialIcon name="bolt" className="text-[14px]" />
              No performance bonus — {formatPercent(breakdown.finalScore, 1)} did not reach the {thresholds.performanceThreshold}% threshold.
            </span>
          )}

          {settlement.isRetry && settlement.recoveryReward > 0 ? (
            <span className="flex items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
              <MaterialIcon name="restart_alt" className="text-[14px]" />
              Retry recovery reward = original stake ÷ attempt number = {formatPoints(settlement.recoveryReward, { suffix: false })} pts.
            </span>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-space-sm pt-space-xs">
          <Link to="/dashboard">
            <Button block iconRight="arrow_forward">
              Return to dashboard
            </Button>
          </Link>
          <Link to="/wallet" className="text-center font-label-sm text-label-sm text-primary hover:underline">
            View ledger in wallet
          </Link>
        </div>

        {/* The settlement `hash` is intentionally NOT rendered. It stays in the
            API payload as the server-side audit reference, but the receipt no
            longer surfaces it to learners. */}

        <p className="pt-space-xs text-center font-label-xs text-label-xs text-on-surface-variant">
          Stakes, rewards and bonuses are virtual platform points. Stake It involves no real money, no wagering and no financial
          transactions.
        </p>
      </div>
    </div>
  );
}

/** Failure receipt shown for a forfeited attempt. */
export function FailureReceipt({
  courseTitle,
  courseCode,
  attemptNumber,
  maxAttempts,
  forfeitedPoints,
  failedAt,
  canRetry,
  enrollmentId,
  recoveryReward,
  onRetry,
  retrying,
}: {
  courseTitle: string;
  courseCode: string;
  attemptNumber: number;
  maxAttempts: number;
  forfeitedPoints: number;
  failedAt: string | null;
  canRetry: boolean;
  enrollmentId: string;
  recoveryReward: number;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="surface-card mx-auto flex w-full max-w-xl flex-col gap-space-lg px-space-lg py-space-lg">
      <div className="flex items-start justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs">
          <span className="flex items-center gap-1.5 font-label-sm text-label-sm text-error">
            <MaterialIcon name="cancel" filled className="text-[16px]" />
            Attempt failed
          </span>
          <h1 className="font-headline-md text-headline-md leading-tight text-on-surface">{courseTitle}</h1>
          <span className="font-mono text-label-xs text-on-surface-variant">{courseCode}</span>
        </div>
        <Chip tone="risk">FAILED</Chip>
      </div>

      <Divider />

      <div className="flex flex-col">
        <MetricRow label="Attempt" value={`#${attemptNumber} of ${maxAttempts}`} />
        <MetricRow label="Failed at" value={formatDateTime(failedAt)} />
        <MetricRow label="Stake forfeited" value={`${forfeitedPoints.toLocaleString('en-US')} pts`} tone="negative" strong />
      </div>

      <p className="font-body-sm text-body-sm text-on-surface-variant">
        The normal course deadline passed without verified completion, so the base stake moved to the platform reward pool.
        The reward pool is never paid directly to another learner.
      </p>

      {canRetry ? (
        <div className="flex flex-col gap-space-md rounded border border-outline-variant bg-surface-container-low px-space-md py-space-md">
          <span className="micro-label text-on-surface-variant">Retry available</span>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            A retry does <strong className="text-on-surface">not</strong> require a new mandatory stake. If the retry succeeds,
            the recovery reward is <span className="font-mono text-on-surface">original stake ÷ {attemptNumber + 1}</span> ={' '}
            <span className="font-mono text-on-surface">{formatPoints(recoveryReward, { suffix: false })} pts</span>.
          </p>
          <div className="flex items-center gap-space-sm">
            <Button icon="restart_alt" loading={retrying} onClick={onRetry}>
              Start retry
            </Button>
            <Link to={`/courses/${enrollmentId}`}>
              <Button variant="secondary">Back to course</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded border border-error/30 bg-error-container/20 px-space-md py-space-md">
          <p className="font-body-sm text-body-sm text-error">
            You have used all {maxAttempts} attempts allowed for this course. Contact an administrator if you believe this is
            an exceptional case.
          </p>
        </div>
      )}
    </div>
  );
}
