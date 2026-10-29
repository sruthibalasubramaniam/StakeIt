import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { enrollmentApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon, ProgressBar } from '../../components/ui/core';
import { Card, CardHeader, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/data';
import { LearningTree, LearningSidebarMeta } from '../../components/domain/LearningTree';
import { FailureReceipt } from '../../components/domain/SettlementReceipt';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatCountdown, formatDate, formatPercent, formatPoints, statusLabel } from '../../utils/format';
import { CertificateCard } from '../../components/domain/CertificateCard';
import { cn } from '../../utils/cn';

/**
 * Learning hub — the enrolled-learner view of `course_page`.
 *
 * Everything shown (lock states, progress, deadlines, stake) comes from the
 * learning-state endpoint; the client never derives unlock rules itself.
 */
export function LearningHubPage() {
  const { enrollmentId = '' } = useParams<{ enrollmentId: string }>();
  const toast = useToast();

  const state = useAsync(() => enrollmentApi.learningState(enrollmentId), [enrollmentId]);
  const entry = useAsync(() => enrollmentApi.detail(enrollmentId), [enrollmentId]);
  const [retrying, setRetrying] = useState(false);

  useDocumentTitle(state.data?.course.title ?? 'Learning');

  if (state.loading || entry.loading) return <LoadingBlock label="Loading your course…" rows={5} />;

  if (state.error || !state.data) {
    return <ErrorBlock title="Could not load this course" message={state.error} onRetry={() => void state.refetch()} />;
  }

  const data = state.data;
  const { course, modules, finalAssessment, progress, deadline, stake, attempt } = data;
  const entryData = entry.data;

  // A closed attempt gets the failure receipt instead of the curriculum.
  if (attempt.status === 'FAILED' && entryData) {
    return (
      <FailureReceipt
        courseTitle={course.title}
        courseCode={course.code}
        attemptNumber={attempt.attemptNumber}
        maxAttempts={course.maxAttempts}
        forfeitedPoints={attempt.pointsForfeited ?? 0}
        failedAt={attempt.completedAt ?? null}
        canRetry={entryData.canRetry}
        enrollmentId={enrollmentId}
        recoveryReward={Math.floor(stake.baseStakeAmount / (attempt.attemptNumber + 1))}
        retrying={retrying}
        onRetry={() => {
          void (async () => {
            setRetrying(true);
            try {
              const result = await enrollmentApi.retry(enrollmentId, {});
              toast.success('Retry started', `Attempt ${result.attempt.attemptNumber} is active. No new stake was required.`);
              await Promise.all([state.refetch(), entry.refetch()]);
            } catch (caught) {
              toast.error('Could not start retry', errorMessage(caught));
            } finally {
              setRetrying(false);
            }
          })();
        }}
      />
    );
  }

  const nextContent = data.nextContent;
  const nextHref = nextContent
    ? nextContent.kind === 'FINAL_ASSESSMENT'
      ? `/learn/${enrollmentId}/final-test`
      : `/learn/${enrollmentId}/content/${nextContent.id}`
    : null;

  return (
    <div className="flex flex-col gap-space-lg">
      <Link to="/my-courses" className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface">
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to my courses
      </Link>

      {/* At-risk band */}
      {deadline.isAtRisk ? (
        <div className="surface-card flex flex-wrap items-center justify-between gap-space-md border-error/30 bg-error-container/10 p-space-lg">
          <div className="flex items-start gap-space-sm">
            <MaterialIcon name="warning" className="mt-0.5 text-error" />
            <div className="flex flex-col">
              <span className="font-label-md text-label-md text-error">{deadline.riskLabel}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                Expected {formatPercent(deadline.expectedProgressPercent)} but you are at {formatPercent(deadline.actualProgressPercent)} —{' '}
                {formatPercent(deadline.gap)} behind with {deadline.daysRemaining} day(s) left. {formatPoints(stake.totalStaked)} at risk.
              </span>
            </div>
          </div>
          {nextHref ? (
            <Link to={nextHref}>
              <Button variant="destructive" iconRight="arrow_forward">
                Continue now
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Header */}
      <div className="flex flex-col gap-space-md lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-space-xs">
          <div className="flex flex-wrap items-center gap-space-sm">
            <span className="font-mono text-label-xs text-on-surface-variant">{course.code}</span>
            <Chip tone={deadline.isAtRisk ? 'risk' : 'stake'}>{deadline.riskLabel}</Chip>
            <Chip tone="info">Attempt {attempt.attemptNumber}</Chip>
            {attempt.acceleratedDeadline && attempt.commitmentMet === null ? <Chip tone="info" icon="timer">accelerated</Chip> : null}
          </div>
          <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">{course.title}</h1>
          <span className="flex flex-wrap items-center gap-space-md font-label-xs text-label-xs text-on-surface-variant">
            <span>Module {progress.completedModules} of {progress.moduleCount} in progress</span>
            <span className="text-outline-variant">•</span>
            <span>{formatPoints(stake.totalStaked)} staked</span>
            <span className="text-outline-variant">•</span>
            <span>Deadline {formatDate(attempt.normalDeadline)}</span>
          </span>
        </div>

        {nextHref ? (
          <Link to={nextHref}>
            <Button size="lg" iconRight="arrow_forward">
              {nextContent?.kind === 'FINAL_ASSESSMENT' ? 'Start final test' : 'Resume learning'}
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-4">
        {/* Curriculum */}
        <div className="lg:col-span-3">
          <LearningTree modules={modules} finalAssessment={finalAssessment} enrollmentId={enrollmentId} />
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-space-lg">
          <Card>
            <CardHeader title="Progress" />
            <Divider />
            <LearningSidebarMeta
              code={course.code}
              daysRemaining={deadline.daysRemaining}
              deadline={attempt.normalDeadline}
              lockedStake={stake.totalStaked}
              riskLabel={deadline.riskLabel}
              atRisk={deadline.isAtRisk}
            />
            <Divider />
            <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
              <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
                <span>Overall</span>
                <span className="metric font-medium text-on-surface">{formatPercent(progress.overallProgressPercent)}</span>
              </div>
              <ProgressBar
                value={progress.overallProgressPercent}
                tone={progress.overallProgressPercent >= 100 ? 'success' : 'primary'}
              />
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                {progress.completedRequired} of {progress.totalRequired} required items complete
              </span>
            </div>
          </Card>

          <CertificateCard attemptId={attempt.id} completed={attempt.status === 'COMPLETED'} />

          <Card>
            <CardHeader title="Stake & rewards" />
            <Divider />
            <div className="flex flex-col gap-space-xs px-space-lg py-space-md">
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-on-surface-variant">Base stake locked</span>
                <span className="font-mono tabular text-on-surface">{formatPoints(stake.baseStake, { suffix: false })}</span>
              </div>
              {stake.commitmentStake > 0 ? (
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Commitment stake</span>
                  <span className="font-mono tabular text-on-surface">{formatPoints(stake.commitmentStake, { suffix: false })}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-on-surface-variant">Completion reward</span>
                <span className="font-mono tabular text-secondary">+{formatPoints(stake.completionReward, { suffix: false })}</span>
              </div>
              {stake.commitmentStake > 0 ? (
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Commitment bonus</span>
                  <span className="font-mono tabular text-secondary">+{formatPoints(stake.commitmentBonus, { suffix: false })}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-on-surface-variant">Performance bonus ≥ {stake.performanceThreshold}%</span>
                <span className="font-mono tabular text-secondary">+{formatPoints(stake.performanceBonus, { suffix: false })}</span>
              </div>
              <Divider className="my-space-xs" />
              <div className="flex items-center justify-between font-label-md text-label-md">
                <span className="text-on-surface">Potential return</span>
                <span className="font-mono tabular text-on-surface">{formatPoints(deadline.potentialReward, { suffix: false })} pts</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Deadlines" />
            <Divider />
            <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
              <div className="flex flex-col">
                <span className="micro-label text-on-surface-variant">Normal deadline</span>
                <span className={cn('font-label-md text-label-md', deadline.daysRemaining <= 3 ? 'text-error' : 'text-on-surface')}>
                  {formatDate(attempt.normalDeadline)} · {formatCountdown(attempt.normalDeadline)}
                </span>
              </div>
              {attempt.acceleratedDeadline ? (
                <div className="flex flex-col">
                  <span className="micro-label text-on-surface-variant">Your accelerated deadline</span>
                  <span className={cn('font-label-md text-label-md', deadline.acceleratedDeadlineMissed ? 'text-error' : 'text-on-surface')}>
                    {formatDate(attempt.acceleratedDeadline)}
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {deadline.acceleratedDeadlineMissed
                      ? 'Missed — bonus forgone, course still active'
                      : `${deadline.acceleratedDaysRemaining ?? 0} day(s) remaining`}
                  </span>
                </div>
              ) : null}
              <div className="flex flex-col">
                <span className="micro-label text-on-surface-variant">Grace period</span>
                <span className="font-label-md text-label-md text-on-surface">{formatDate(attempt.graceDeadline)}</span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  {course.gracePeriodHours}h buffer before forfeiture
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Rules in force" />
            <Divider />
            <ul className="flex flex-col gap-space-xs px-space-lg py-space-md">
              {[
                `Videos require ${course.requiredWatchPercent}% valid watch time — scrubbing ahead does not count.`,
                'Content unlocks sequentially: video/reading → quiz → module assessment → next module.',
                'The final test unlocks only after every required module is passed.',
                `Final score = module score × ${course.moduleWeight}% + final test × ${course.finalTestWeight}%.`,
                course.minFinalTestScore !== null
                  ? `You must score at least ${course.minFinalTestScore}% on the final test.`
                  : 'No minimum final-test score is configured for this course.',
                `Status: ${statusLabel(attempt.status)}.`,
              ].map((rule) => (
                <li key={rule} className="flex items-start gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
                  <MaterialIcon name="rule" className="mt-0.5 shrink-0 text-[15px]" />
                  {rule}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      {!nextContent && !finalAssessment?.isUnlocked ? (
        <Card>
          <EmptyState
            icon="hourglass_top"
            title="Nothing to resume"
            description="Every available item is complete. Check the module list above for anything still locked."
          />
        </Card>
      ) : null}
    </div>
  );
}


