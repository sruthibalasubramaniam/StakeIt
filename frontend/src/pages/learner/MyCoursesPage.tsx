import { useState } from 'react';
import { Link } from 'react-router-dom';
import { enrollmentApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon, ProgressBar } from '../../components/ui/core';
import { Card, ConfirmDialog, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatCard, Tabs } from '../../components/ui/data';
import { AtRiskBanner } from '../../components/domain/AccountabilityPanels';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatCountdown, formatDate, formatPercent, formatPoints, statusLabel } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { EnrollmentRow } from '../../types/api';

type TabId = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'WITHDRAWN' | 'ALL';

export function MyCoursesPage() {
  useDocumentTitle('My courses');
  const toast = useToast();

  const enrollments = useAsync(() => enrollmentApi.list(), []);
  const [tab, setTab] = useState<TabId>('ACTIVE');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<EnrollmentRow | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const rows = enrollments.data ?? [];
  const filtered = tab === 'ALL' ? rows : rows.filter((row) => row.status === tab);

  const countFor = (status: TabId) => (status === 'ALL' ? rows.length : rows.filter((row) => row.status === status).length);

  const startRetry = async (enrollmentId: string) => {
    setRetrying(enrollmentId);
    try {
      const result = await enrollmentApi.retry(enrollmentId, {});
      toast.success(
        'Retry started',
        `Attempt ${result.attempt.attemptNumber} is active. No new stake was required.`,
      );
      await enrollments.refetch();
    } catch (caught) {
      toast.error('Could not start retry', errorMessage(caught));
    } finally {
      setRetrying(null);
    }
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      const result = await enrollmentApi.withdraw(withdrawTarget.id);
      toast.success('Withdrawn', `${result.returnedPoints} points returned to your wallet.`);
      setWithdrawTarget(null);
      await enrollments.refetch();
    } catch (caught) {
      toast.error('Could not withdraw', errorMessage(caught));
    } finally {
      setWithdrawing(false);
    }
  };

  const totalLocked = rows
    .filter((row) => row.status === 'ACTIVE')
    .reduce((sum, row) => sum + row.stake.locked, 0);
  const atRiskCount = rows.filter((row) => row.pacing?.isAtRisk).length;

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        title="My courses"
        meta={
          <div className="flex items-center gap-space-lg">
            <span className="flex items-baseline gap-1.5">
              <span className="micro-label text-on-surface-variant">Locked:</span>
              <span className="font-mono text-label-md tabular text-on-surface">{formatPoints(totalLocked, { suffix: false })} pts</span>
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard label="Active" value={countFor('ACTIVE')} icon="play_circle" tone="primary" />
        <StatCard label="Completed" value={countFor('COMPLETED')} icon="workspace_premium" tone="success" />
        <StatCard label="Failed" value={countFor('FAILED')} icon="cancel" tone={countFor('FAILED') > 0 ? 'risk' : 'neutral'} />
        <StatCard label="At risk" value={atRiskCount} icon="warning" tone={atRiskCount > 0 ? 'risk' : 'neutral'} />
      </div>

      <Tabs
        tabs={[
          { id: 'ACTIVE', label: 'Active', count: countFor('ACTIVE') },
          { id: 'COMPLETED', label: 'Completed', count: countFor('COMPLETED') },
          { id: 'FAILED', label: 'Failed', count: countFor('FAILED') },
          { id: 'ALL', label: 'All', count: countFor('ALL') },
        ]}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      {enrollments.error ? (
        <ErrorBlock title="Could not load your courses" message={enrollments.error} onRetry={() => void enrollments.refetch()} />
      ) : enrollments.loading ? (
        <LoadingBlock label="Loading enrolments…" rows={3} />
      ) : filtered.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon="school"
            title={tab === 'ALL' ? 'No enrolments yet' : `No ${tab.toLowerCase()} courses`}
            description={
              tab === 'FAILED'
                ? 'Nothing has failed — every attempt so far is still on track.'
                : 'Browse the catalogue and stake points on a course to start tracking.'
            }
            action={
              <Link
                to="/courses"
                className="inline-flex items-center gap-1 rounded bg-primary-container px-space-md py-1.5 font-label-sm text-label-sm text-on-primary hover:bg-primary"
              >
                Browse courses
                <MaterialIcon name="arrow_forward" className="text-[16px]" />
              </Link>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-space-md">
          {filtered.map((row) => (
            <EnrollmentCard
              key={row.id}
              row={row}
              onRetry={() => void startRetry(row.id)}
              retrying={retrying === row.id}
              onWithdraw={() => setWithdrawTarget(row)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(withdrawTarget)}
        onClose={() => setWithdrawTarget(null)}
        onConfirm={() => void confirmWithdraw()}
        title="Withdraw from this course?"
        message="You can only withdraw before starting any course content. Your locked stake will be returned in full and the attempt will be closed."
        confirmLabel="Withdraw and return stake"
        destructive
        pending={withdrawing}
      />
    </div>
  );
}

function EnrollmentCard({
  row,
  onRetry,
  retrying,
  onWithdraw,
}: {
  row: EnrollmentRow;
  onRetry: () => void;
  retrying: boolean;
  onWithdraw: () => void;
}) {
  const attempt = row.activeAttempt;
  const pacing = row.pacing;
  const isFailed = row.status === 'FAILED';
  const isCompleted = row.status === 'COMPLETED';
  const attemptsRemaining = row.course.maxAttempts - row.attemptCount;

  return (
    <Card className={cn(pacing?.isAtRisk && 'border-error/30')}>
      <div className="flex flex-col gap-space-md p-space-lg">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-space-sm">
              <span className="font-mono text-label-xs text-on-surface-variant">{row.course.code}</span>
              <Chip tone={isCompleted ? 'earned' : isFailed ? 'risk' : pacing?.isAtRisk ? 'risk' : 'stake'}>
                {pacing?.riskLabel ?? statusLabel(row.status)}
              </Chip>
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                Attempt {row.attemptCount} of {row.course.maxAttempts}
              </span>
            </div>
            <Link to={`/courses/${row.course.slug}`} className="font-headline-sm text-headline-sm text-on-surface hover:text-primary">
              {row.course.title}
            </Link>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              Enrolled {formatDate(row.enrolledAt)}
              {row.completedAt ? ` · completed ${formatDate(row.completedAt)}` : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-space-sm">
            {row.status === 'ACTIVE' && attempt ? (
              <>
                <Link to={`/learn/${row.id}`}>
                  <Button icon="play_arrow">Resume</Button>
                </Link>
                <Button variant="secondary" icon="logout" onClick={onWithdraw}>
                  Withdraw
                </Button>
              </>
            ) : null}

            {isCompleted && attempt?.id ? (
              <>
                <Link to={`/learn/${row.id}/completion`}>
                  <Button variant="secondary" icon="receipt_long">
                    Receipt
                  </Button>
                </Link>
                <Link to={`/courses/${row.course.slug}`}>
                  <Button variant="ghost" icon="reviews">
                    {row.review ? 'Your review' : 'Write a review'}
                  </Button>
                </Link>
              </>
            ) : null}

            {isFailed ? (
              attemptsRemaining > 0 ? (
                <Button icon="restart_alt" loading={retrying} onClick={onRetry}>
                  Retry (no new stake)
                </Button>
              ) : (
                <Chip tone="risk">No attempts remaining</Chip>
              )
            ) : null}
          </div>
        </div>

        {row.status === 'ACTIVE' && pacing ? (
          <>
            <Divider />
            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
                  <span className={pacing.isAtRisk ? 'font-medium text-error' : ''}>
                    {pacing.isAtRisk ? 'Pacing behind' : 'Progress'}
                  </span>
                  <span className={cn('metric font-medium', pacing.isAtRisk ? 'text-error' : 'text-on-surface')}>
                    {formatPercent(pacing.actualProgressPercent)}
                  </span>
                </div>
                <ProgressBar value={pacing.actualProgressPercent} tone={pacing.isAtRisk ? 'risk' : 'primary'} />
              </div>

              <div className="flex flex-col gap-1">
                <span className="micro-label text-on-surface-variant">Deadline</span>
                <span className={cn('font-label-md text-label-md', pacing.isAtRisk ? 'text-error' : 'text-on-surface')}>
                  {formatCountdown(attempt?.normalDeadline)}
                </span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  {formatDate(attempt?.normalDeadline)} · grace {row.course.gracePeriodHours}h
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="micro-label text-on-surface-variant">Stake at risk</span>
                <span className="font-mono text-label-md tabular text-on-surface">{formatPoints(row.stake.locked, { suffix: false })} pts</span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  Potential return {formatPoints(row.stake.potentialReward, { suffix: false })} pts
                </span>
              </div>
            </div>

            {attempt?.acceleratedDeadline ? (
              <div className="flex flex-wrap items-center gap-space-sm rounded border border-outline-variant bg-surface-container-low px-space-md py-space-sm">
                <MaterialIcon name="timer" className="text-[16px] text-on-surface-variant" />
                <span className="font-label-sm text-label-sm text-on-surface">
                  Accelerated deadline {formatDate(attempt.acceleratedDeadline)}
                  {pacing?.acceleratedDeadlineMissed
                    ? ' — missed. The bonus is forgone; the course stays active.'
                    : ` · ${pacing?.acceleratedDaysRemaining ?? 0} day(s) left`}
                </span>
              </div>
            ) : null}

            {pacing?.isAtRisk ? (
              <AtRiskBanner
                title={row.course.title}
                code={row.course.code}
                progressPercent={pacing.actualProgressPercent}
                expectedProgressPercent={pacing.expectedProgressPercent}
                gap={pacing.gap}
                daysRemaining={pacing.daysRemaining}
                lockedStake={row.stake.locked}
                enrollmentId={row.id}
              />
            ) : null}
          </>
        ) : null}

        {isFailed ? (
          <>
            <Divider />
            <div className="flex flex-col gap-space-sm">
              <div className="flex flex-wrap items-center gap-space-md">
                <Chip tone="risk" icon="gavel">
                  {row.attempts[0]?.pointsForfeited ?? 0} pts forfeited
                </Chip>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  {attemptsRemaining} of {row.course.maxAttempts} attempts remaining
                </span>
              </div>
              {attemptsRemaining > 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  The stake moved to the platform reward pool. A retry does not require a new mandatory stake — if it succeeds, the
                  recovery reward is the original stake divided by {row.attemptCount + 1}, and the completion reward still applies.
                </p>
              ) : (
                <p className="font-body-sm text-body-sm text-error">
                  All {row.course.maxAttempts} attempts have been used. Contact an administrator if you believe this is an
                  exceptional case.
                </p>
              )}
            </div>
          </>
        ) : null}

        {row.attempts.length > 0 ? (
          <>
            <Divider />
            <details className="group">
              <summary className="flex cursor-pointer items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface">
                <MaterialIcon name="history" className="text-[16px]" />
                Attempt history ({row.attempts.length})
                <MaterialIcon name="expand_more" className="text-[16px] transition-transform group-open:rotate-180" />
              </summary>
              <ul className="mt-space-sm flex flex-col divide-y divide-outline-variant">
                {row.attempts.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-space-md py-space-sm">
                    <span className="flex items-center gap-space-md">
                      <span className="font-mono text-label-xs tabular text-on-surface-variant">#{entry.attemptNumber}</span>
                      <Chip tone={entry.status === 'COMPLETED' ? 'earned' : entry.status === 'FAILED' ? 'risk' : 'info'}>
                        {statusLabel(entry.status)}
                      </Chip>
                    </span>
                    <span className="flex items-center gap-space-lg font-label-xs text-label-xs text-on-surface-variant">
                      {entry.finalScore !== null ? <span className="metric text-on-surface">{formatPercent(entry.finalScore, 1)}</span> : null}
                      {entry.pointsAwarded > 0 ? <span className="text-secondary">+{entry.pointsAwarded} pts</span> : null}
                      {entry.pointsForfeited > 0 ? <span className="text-error">−{entry.pointsForfeited} pts</span> : null}
                      <span>{formatDate(entry.completedAt ?? entry.failedAt ?? entry.startedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </div>
    </Card>
  );
}
