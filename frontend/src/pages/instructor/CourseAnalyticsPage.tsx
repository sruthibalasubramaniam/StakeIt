import { Link, useParams } from 'react-router-dom';
import { courseApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Divider, MaterialIcon } from '../../components/ui/core';
import { Card, CardHeader, ErrorBlock, LoadingBlock, MetricRow, SectionHeader, StatCard } from '../../components/ui/data';
import { BarList, RatingDistribution, ScoreGauge } from '../../components/domain/Charts';
import { ReviewList } from '../../components/domain/ReviewPanel';
import { useCourseAreaBase } from '../../router/routeAccess';
import { formatPercent } from '../../utils/format';

/** Per-course analytics: funnel, scores, commitment performance and ratings. */
export function CourseAnalyticsPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  useDocumentTitle('Course analytics');
  const areaBase = useCourseAreaBase();

  const analytics = useAsync(() => courseApi.analytics(courseId), [courseId]);
  const detail = useAsync(() => courseApi.preview(courseId).catch(() => null), [courseId]);
  const reviews = useAsync(
    () => (detail.data ? courseApi.reviews(detail.data.id) : Promise.resolve(null)).catch(() => null),
    [detail.data?.id],
    { enabled: Boolean(detail.data?.id) },
  );

  if (analytics.loading) return <LoadingBlock label="Crunching analytics…" rows={5} />;
  if (analytics.error || !analytics.data) {
    return <ErrorBlock title="Could not load analytics" message={analytics.error} onRetry={() => void analytics.refetch()} />;
  }

  const { course, overview, ratings, moduleFunnel } = analytics.data;
  const retryRate = overview.enrolled > 0 ? overview.retries / overview.enrolled : 0;

  return (
    <div className="flex flex-col gap-space-lg">
      <Link
        to={areaBase}
        className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
      >
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to my courses
      </Link>

      <SectionHeader
        eyebrow={`Course ${course.code}`}
        title={course.title}
        meta={
          <div className="flex items-center gap-space-sm">
            <Link to={`${areaBase}/${courseId}/builder`}>
              <Button variant="secondary" icon="construction">
                Builder
              </Button>
            </Link>
            <Link to={`${areaBase}/${courseId}/learners`}>
              <Button variant="secondary" icon="group">
                Learners
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard label="Enrolled" value={overview.enrolled} icon="group" hint={`${overview.active} active`} />
        <StatCard
          label="Completion rate"
          value={formatPercent(overview.completionRate * 100)}
          icon="task_alt"
          tone="success"
          hint={`${overview.completed} completed · ${overview.failed} failed`}
        />
        <StatCard
          label="Average score"
          value={overview.averageScore > 0 ? formatPercent(overview.averageScore, 1) : '—'}
          icon="trending_up"
          hint={`Module ${formatPercent(overview.averageModuleScore, 0)} · test ${formatPercent(overview.averageFinalTestScore, 0)}`}
        />
        <StatCard
          label="Retry rate"
          value={formatPercent(retryRate * 100)}
          icon="restart_alt"
          hint={`${overview.retries} retry attempt(s)`}
        />
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Module completion funnel"
            subtitle="Distinct learners who finished every required item in each module"
          />
          <Divider />
          <div className="p-space-lg">
            <BarList
              data={moduleFunnel.map((module) => ({
                label: `${String(module.orderIndex + 1).padStart(2, '0')} ${module.title}`,
                value: module.completedLearners,
                tone: module.completedLearners > 0 ? 'primary' : 'muted',
                hint: module.title,
              }))}
              unit=""
              emptyLabel="No module data yet"
            />
          </div>
        </Card>

        <div className="flex flex-col gap-space-lg">
          <Card>
            <CardHeader title="Score profile" />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              <ScoreGauge value={overview.averageScore} threshold={70} label="Average final score" />
              <MetricRow label="Average module score" value={overview.averageModuleScore > 0 ? formatPercent(overview.averageModuleScore, 1) : '—'} />
              <MetricRow
                label="Average final test"
                value={overview.averageFinalTestScore > 0 ? formatPercent(overview.averageFinalTestScore, 1) : '—'}
              />
              <MetricRow label="Weighting" value={`${course.moduleWeight}% / ${course.finalTestWeight}%`} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Accelerated commitments" />
            <Divider />
            <div className="p-space-lg">
              <MetricRow label="Commitments taken" value={String(overview.commitmentAttempts)} />
              <MetricRow label="Commitments met" value={String(overview.commitmentSuccesses)} tone="positive" />
              <MetricRow
                label="Success rate"
                value={overview.commitmentAttempts > 0 ? formatPercent(overview.commitmentSuccessRate * 100) : '—'}
              />
              <p className="mt-space-sm font-label-xs text-label-xs text-on-surface-variant">
                Missing an accelerated deadline never fails a course — it only forfeits the commitment bonus.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Points flow" />
            <Divider />
            <div className="p-space-lg">
              <MetricRow label="Points awarded" value={`${overview.pointsAwarded} pts`} tone="positive" />
              <MetricRow label="Points forfeited" value={`${overview.pointsForfeited} pts`} tone="negative" />
              <MetricRow
                label="Net learner position"
                value={`${overview.pointsAwarded - overview.pointsForfeited} pts`}
                strong
              />
              <p className="mt-space-sm font-label-xs text-label-xs text-on-surface-variant">
                Forfeited points go to the platform reward pool, never directly to another learner.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Ratings"
            subtitle={ratings.count > 0 ? `${ratings.count} review(s) · ${ratings.average.toFixed(1)}/5 average` : 'No ratings yet'}
          />
          <Divider />
          <div className="p-space-lg">
            <RatingDistribution distribution={ratings.distribution} />
            {ratings.count > 0 ? (
              <div className="mt-space-md">
                <MetricRow label="Would recommend" value={formatPercent(ratings.recommendationRate * 100)} />
                <MetricRow
                  label="Average difficulty"
                  value={ratings.averageDifficulty > 0 ? `${ratings.averageDifficulty.toFixed(1)}/5` : '—'}
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Learner reviews" subtitle="Written feedback from verified graduates" />
          <Divider />
          <div className="px-space-lg">
            {reviews.loading ? (
              <LoadingBlock label="Loading reviews…" rows={2} />
            ) : reviews.data ? (
              <ReviewList reviews={(reviews.data.reviews ?? []) as never[]} />
            ) : (
              <p className="py-space-md font-body-sm text-body-sm text-on-surface-variant">
                Reviews are loaded from the public course endpoint.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
