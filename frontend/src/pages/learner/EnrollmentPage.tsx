import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { courseApi, enrollmentApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock } from '../../components/ui/data';
import { MetricRow } from '../../components/ui/data';
import { Radio, Switch } from '../../components/ui/forms';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { cn } from '../../utils/cn';
import { formatDate, formatPoints } from '../../utils/format';
import type { Recommendation } from '../../types/api';

/**
 * Enrolment + stake configuration — the `course_enrollment` design.
 *
 * The balance figures here are a *preview only*. The API re-checks the balance
 * and re-locks the stake inside a transaction, so a stale browser cannot
 * overdraw a wallet or enrol without a stake.
 */
export function EnrollmentPage() {
  const { idOrSlug = '' } = useParams<{ idOrSlug: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const walletFromAuth = user?.wallet;

  const course = useAsync(() => courseApi.detail(idOrSlug), [idOrSlug]);
  const recommendation = useAsync(
    () => courseApi.recommendation(course.data!.id).catch(() => null),
    [course.data?.id],
    { enabled: Boolean(course.data?.id) },
  );

  const [accelerated, setAccelerated] = useState(false);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(course.data ? `Enrol · ${course.data.title}` : 'Enrol');

  const options = course.data?.commitmentOptions ?? [];

  // Default to the recommended (or course-default) accelerated option.
  useEffect(() => {
    if (options.length === 0) return;
    const recommendedId = recommendation.data?.recommendedCommitmentOptionId;
    const defaultId = options.find((option) => option.isDefault)?.id ?? options[0]!.id;
    setOptionId((current) => current ?? recommendedId ?? defaultId);
  }, [options, recommendation.data]);

  const selectedOption = useMemo(
    () => options.find((option) => option.id === optionId) ?? null,
    [options, optionId],
  );

  if (course.loading) return <LoadingBlock label="Loading course…" rows={5} />;
  if (course.error || !course.data) {
    return <ErrorBlock title="Could not load this course" message={course.error} onRetry={() => void course.refetch()} />;
  }

  const detail = course.data;
  const baseStake = detail.baseStake;
  const commitmentStake = accelerated && selectedOption ? selectedOption.commitmentStake : 0;
  const totalStake = baseStake + commitmentStake;

  // Preview only — the API re-checks this inside the staking transaction.
  const availableBalance = walletFromAuth?.availableBalance ?? 0;
  const shortfall = totalStake > availableBalance;

  const enrol = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await enrollmentApi.enroll(detail.id, {
        accelerated: accelerated && Boolean(selectedOption),
        commitmentOptionId: accelerated ? selectedOption?.id ?? null : null,
      });
      toast.success(
        result.isRetry ? 'Retry started' : 'Enrolment confirmed',
        result.isRetry
          ? 'Your retry is active — no additional stake was required.'
          : `${totalStake} points are now in escrow.`,
      );
      navigate(`/learn/${result.enrollment.id}`, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <Link
        to={`/courses/${detail.slug}`}
        className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
      >
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to course
      </Link>

      <div className="flex flex-col gap-space-xs">
        <span className="micro-label text-on-surface-variant">
          Curriculum {detail.code} · Standard accountability track
        </span>
        <h1 className="font-headline-xl text-headline-xl-mobile tracking-tight text-on-surface md:text-headline-xl">
          {detail.title}
        </h1>
        <p className="max-w-3xl font-body-md text-body-md leading-relaxed text-on-surface-variant">{detail.description}</p>
      </div>

      {error ? (
        <Alert tone="error" title="Could not complete enrolment">
          {error}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <div className="flex flex-col gap-space-lg lg:col-span-2">
          {/* Commitment parameter */}
          <Card>
            <CardHeader
              title="Commitment parameter"
              subtitle="Your stake is held in escrow and returned on verified completion."
            />
            <Divider />
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-space-md bg-surface-container-low px-space-lg py-space-md">
                <span className="flex items-center gap-space-sm font-label-md text-label-md text-on-surface">
                  <MaterialIcon name="lock" className="text-on-surface-variant" />
                  Stake required
                </span>
                <span className="font-headline-sm text-headline-sm tabular text-on-surface">{baseStake} points</span>
              </div>

              <div className="flex flex-col gap-space-md px-space-lg py-space-md">
                <Switch
                  checked={accelerated && options.length > 0}
                  onChange={setAccelerated}
                  disabled={options.length === 0}
                  label="Finish early for bonus points"
                  description={
                    options.length === 0
                      ? 'This course does not offer an accelerated commitment option.'
                      : 'Lock in an accelerated delivery deadline to earn additional protocol yield.'
                  }
                />

                {accelerated && options.length > 0 ? (
                  <div className="flex flex-col gap-space-xs rounded border border-outline-variant bg-surface-container-lowest p-space-xs">
                    {options.map((option) => (
                      <Radio
                        key={option.id}
                        name="commitment"
                        value={option.id}
                        checked={optionId === option.id}
                        onChange={setOptionId}
                        label={`${option.label} — ${formatPoints(option.commitmentStake)} commitment stake`}
                        detail={`Deadline ${formatDate(
                          new Date(Date.now() + option.durationDays * 86_400_000),
                        )} · commitment bonus +${option.commitmentBonus} pts`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <Divider />

              <div className="px-space-lg py-space-md">
                <MetricRow label="Base stake" value={`${baseStake} pts`} />
                {commitmentStake > 0 ? <MetricRow label="Accelerated commitment stake" value={`${commitmentStake} pts`} /> : null}
                <MetricRow label="Total to lock now" value={`${totalStake} pts`} strong />
                <MetricRow label="Normal deadline" value={formatDate(new Date(Date.now() + detail.durationDays * 86_400_000))} />
                {accelerated && selectedOption ? (
                  <MetricRow
                    label="Your accelerated deadline"
                    value={formatDate(new Date(Date.now() + selectedOption.durationDays * 86_400_000))}
                    sub="Missing this only forfeits the bonus — the course stays active"
                  />
                ) : null}
              </div>
            </div>
          </Card>

          {/* Business rules */}
          <Card>
            <CardHeader title="How the accountability protocol works" />
            <Divider />
            <ul className="flex flex-col gap-space-sm px-space-lg py-space-md">
              {[
                'The base stake is returned in full when you complete the course and pass the final assessment.',
                'The course completion reward is separate from the stake return — you earn both.',
                'An accelerated commitment is optional. Its stake is returned when the accelerated deadline is met.',
                'The commitment bonus is an additional reward, separate from the commitment stake.',
                'Missing the accelerated deadline does NOT fail the course. You keep working toward the normal deadline.',
                'Missing the normal course deadline fails the attempt and forfeits the base stake.',
                `Forfeited points go to the platform reward pool. You may retry up to ${detail.maxAttempts} times, and a retry does not require a new mandatory stake.`,
                'If a retry succeeds, the recovery reward is the original stake divided by the attempt number.',
              ].map((rule) => (
                <li key={rule} className="flex items-start gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
                  <MaterialIcon name="check_circle" className="mt-0.5 shrink-0 text-[15px] text-secondary" />
                  {rule}
                </li>
              ))}
            </ul>
          </Card>

          {/* Recommendation */}
          {recommendation.data ? <RecommendationPanel recommendation={recommendation.data} /> : null}
        </div>

        {/* Right: confirm */}
        <div className="flex flex-col gap-space-lg">
          <Card>
            <CardHeader title="Confirm enrolment" />
            <Divider />
            <div className="flex flex-col gap-space-md px-space-lg py-space-md">
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-on-surface-variant">Available balance</span>
                <span className="font-mono tabular text-on-surface">
                  {(availableBalance ?? 0).toLocaleString('en-US')} pts
                </span>
              </div>
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-on-surface-variant">Balance after stake</span>
                <span className={cn('font-mono tabular', shortfall ? 'text-error' : 'text-on-surface')}>
                  {Math.max(0, (availableBalance ?? 0) - totalStake).toLocaleString('en-US')} pts
                </span>
              </div>
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-on-surface-variant">Staking now</span>
                <Chip tone="stake">{totalStake} pts</Chip>
              </div>
              {shortfall ? (
                <Alert tone="error" title="Insufficient points">
                  You need {totalStake} points but only {(availableBalance ?? 0).toLocaleString('en-US')} are available. The API
                  will reject this enrolment — earn or free up points first.
                </Alert>
              ) : null}

              <Alert tone="info" icon="shield">
                Staked points are placed into verifiable escrow. Forfeiture occurs only if course milestones are not verified
                before the normal term expires.
              </Alert>

              <Button block size="lg" iconRight="arrow_forward" loading={submitting} onClick={() => void enrol()}>
                Enrol and stake {totalStake} points
              </Button>

              <p className="text-center font-label-xs text-label-xs text-on-surface-variant">
                The server re-validates your balance and locks the stake atomically. Nothing is deducted in the browser.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Potential return" />
            <Divider />
            <div className="px-space-lg py-space-md">
              <MetricRow label="Stake returned" value={`${totalStake} pts`} tone="positive" />
              <MetricRow label="Course reward" value={`+${detail.completionReward} pts`} tone="positive" />
              {accelerated && selectedOption ? (
                <MetricRow label="Commitment bonus" value={`+${selectedOption.commitmentBonus} pts`} tone="positive" />
              ) : null}
              <MetricRow
                label={`Performance bonus (≥ ${detail.performanceThreshold}%)`}
                value={`+${detail.performanceBonus} pts`}
                tone="positive"
              />
              <MetricRow
                label="Maximum total"
                value={`${totalStake + detail.completionReward + (accelerated && selectedOption ? selectedOption.commitmentBonus : 0) + detail.performanceBonus} pts`}
                strong
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RecommendationPanel({ recommendation }: { recommendation: Recommendation }) {
  const stanceTone =
    recommendation.stance === 'AMBITIOUS' ? 'stake' : recommendation.stance === 'CAUTIOUS' ? 'risk' : 'info';

  return (
    <Card>
      <CardHeader
        title="Adaptive stake recommendation"
        subtitle={`Confidence: ${recommendation.confidence.toLowerCase()} · rule-based on your track record`}
        action={<Chip tone={stanceTone as 'stake'}>{recommendation.stance.toLowerCase()}</Chip>}
      />
      <Divider />
      <div className="flex flex-col gap-space-md px-space-lg py-space-md">
        <div className="grid grid-cols-2 gap-space-md sm:grid-cols-4">
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Suggested stake</span>
            <span className="font-mono text-label-md tabular text-on-surface">{recommendation.recommendedStake} pts</span>
          </div>
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Suggested window</span>
            <span className="font-mono text-label-md tabular text-on-surface">{recommendation.recommendedDurationDays} days</span>
          </div>
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Completion rate</span>
            <span className="font-mono text-label-md tabular text-on-surface">
              {Math.round(recommendation.learnerStatistics.completionRate * 100)}%
            </span>
          </div>
          <div className="flex flex-col">
            <span className="micro-label text-on-surface-variant">Average score</span>
            <span className="font-mono text-label-md tabular text-on-surface">
              {recommendation.learnerStatistics.averageScore.toFixed(1)}%
            </span>
          </div>
        </div>

        <ul className="flex flex-col gap-space-xs">
          {recommendation.rationale.map((line) => (
            <li key={line} className="flex items-start gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
              <MaterialIcon name="insights" className="mt-0.5 shrink-0 text-[15px]" />
              {line}
            </li>
          ))}
        </ul>

        <p className="font-label-xs text-label-xs text-on-surface-variant">
          This is a suggestion only — Stake It never changes your commitment for you.
        </p>
      </div>
    </Card>
  );
}
