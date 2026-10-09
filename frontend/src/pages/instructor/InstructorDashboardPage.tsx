import { Link } from 'react-router-dom';
import { analyticsApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Card, CardHeader, DataTable, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatCard } from '../../components/ui/data';
import { ColumnChart, ScoreGauge, TierLadder } from '../../components/domain/Charts';
import { ReputationBadge } from '../../components/domain/CourseCard';
import { formatDate, formatPercent, formatRelative, statusLabel } from '../../utils/format';
import { cn } from '../../utils/cn';

/** Instructor dashboard: teaching outcomes, course health and reputation. */
export function InstructorDashboardPage() {
  useDocumentTitle('Instructor dashboard');
  const dashboard = useAsync(() => analyticsApi.instructorDashboard(), []);

  if (dashboard.loading) return <LoadingBlock label="Loading your dashboard…" rows={5} />;
  if (dashboard.error || !dashboard.data) {
    return <ErrorBlock title="Could not load your dashboard" message={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }

  const { overview, courses, reputation, recentActivity } = dashboard.data;
  const settled = overview.completions + overview.failures;

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Instructor protocol"
        title="Teaching dashboard"
        meta={
          <div className="flex items-center gap-space-md">
            <ReputationBadge tier={reputation.tier} />
            <Link to="/instructor/courses">
              <Button icon="add" size="sm">
                New course
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard label="Learners" value={overview.totalLearners} icon="group" hint={`${overview.activeAttempts} active attempt(s)`} />
        <StatCard
          label="Completion rate"
          value={formatPercent(overview.completionRate * 100)}
          icon="task_alt"
          tone="success"
          hint={`${overview.completions} of ${settled} settled`}
        />
        <StatCard
          label="Average score"
          value={overview.averageScore > 0 ? formatPercent(overview.averageScore, 1) : '—'}
          icon="trending_up"
          hint="Weighted final course score"
        />
        <StatCard
          label="At risk"
          value={overview.atRiskAttempts}
          icon="warning"
          tone={overview.atRiskAttempts > 0 ? 'risk' : 'neutral'}
          hint="Behind expected progress"
        />
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Course performance"
            subtitle="Completions and average score per published course"
            action={
              <Link to="/instructor/courses" className="font-label-sm text-label-sm text-primary hover:underline">
                Manage courses
              </Link>
            }
          />
          <Divider />
          <div className="p-space-lg">
            {courses.length === 0 ? (
              <EmptyState
                icon="library_books"
                title="No courses yet"
                description="Create your first accountability course to start tracking learner outcomes."
                action={
                  <Link to="/instructor/courses/create">
                    <Button icon="add">Create a course</Button>
                  </Link>
                }
              />
            ) : (
              <ColumnChart
                data={courses.slice(0, 8).map((course) => ({
                  label: course.code,
                  value: course.averageScore,
                  tone: course.averageScore >= 75 ? 'success' : course.averageScore > 0 ? 'primary' : 'muted',
                  hint: `${course.title} · ${course.completions} completion(s)`,
                }))}
                unit="%"
                height={180}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Reputation"
            subtitle={`Composite score ${reputation.compositeScore}`}
            action={<Chip tone={reputation.featuredEligible ? 'earned' : 'info'}>{reputation.featuredEligible ? 'featured eligible' : 'building'}</Chip>}
          />
          <Divider />
          <div className="flex flex-col gap-space-md p-space-lg">
            <ScoreGauge
              value={reputation.compositeScore}
              threshold={75}
              label="Weighted reputation"
            />
            <div className="grid grid-cols-2 gap-space-sm">
              <div className="flex flex-col">
                <span className="micro-label text-on-surface-variant">Settled outcomes</span>
                <span className="font-mono text-label-md tabular text-on-surface">{reputation.metrics.learnerOutcomes}</span>
              </div>
              <div className="flex flex-col">
                <span className="micro-label text-on-surface-variant">Distinct learners</span>
                <span className="font-mono text-label-md tabular text-on-surface">{reputation.metrics.distinctLearners}</span>
              </div>
              <div className="flex flex-col">
                <span className="micro-label text-on-surface-variant">Commitment success</span>
                <span className="font-mono text-label-md tabular text-on-surface">
                  {formatPercent(reputation.metrics.commitmentSuccessRate * 100)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="micro-label text-on-surface-variant">Average rating</span>
                <span className="font-mono text-label-md tabular text-on-surface">
                  {reputation.metrics.averageRating > 0 ? `${reputation.metrics.averageRating.toFixed(1)}/5` : '—'}
                </span>
              </div>
            </div>
            <Divider />
            <TierLadder progress={reputation.tierProgress} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Course health"
          subtitle="Per-course completion, scores and ratings"
        />
        <DataTable
          rows={courses}
          keyFor={(row) => row.id}
          empty={<EmptyState icon="library_books" title="No courses yet" />}
          columns={[
            {
              key: 'course',
              header: 'Course',
              render: (row) => (
                <div className="flex flex-col">
                  <Link to={`/instructor/courses/${row.id}/builder`} className="font-label-md text-label-md text-on-surface hover:text-primary">
                    {row.title}
                  </Link>
                  <span className="flex items-center gap-space-sm font-label-xs text-label-xs text-on-surface-variant">
                    <span className="font-mono">{row.code}</span>
                    <Chip tone={row.status === 'PUBLISHED' ? 'earned' : row.status === 'DRAFT' ? 'info' : 'locked'}>
                      {statusLabel(row.status)}
                    </Chip>
                  </span>
                </div>
              ),
            },
            { key: 'learners', header: 'Learners', align: 'right', render: (row) => <span className="metric">{row.learnerCount}</span> },
            { key: 'completions', header: 'Completions', align: 'right', render: (row) => <span className="metric">{row.completions}</span> },
            {
              key: 'score',
              header: 'Avg score',
              align: 'right',
              render: (row) => (
                <span className={cn('metric', row.averageScore >= 75 ? 'text-secondary' : 'text-on-surface')}>
                  {row.averageScore > 0 ? formatPercent(row.averageScore, 1) : '—'}
                </span>
              ),
            },
            {
              key: 'rating',
              header: 'Rating',
              align: 'right',
              render: (row) =>
                row.ratingCount > 0 ? (
                  <span className="metric">
                    {row.averageRating.toFixed(1)} <span className="opacity-60">({row.ratingCount})</span>
                  </span>
                ) : (
                  <span className="text-on-surface-variant">—</span>
                ),
            },
            {
              key: 'updated',
              header: 'Updated',
              align: 'right',
              render: (row) => <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(row.updatedAt)}</span>,
            },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title="Recent learner activity" subtitle="Latest attempt updates across your courses" />
        <Divider />
        {recentActivity.length === 0 ? (
          <EmptyState icon="history" title="No activity yet" />
        ) : (
          <ul className="divide-y divide-outline-variant">
            {recentActivity.map((activity) => (
              <li key={activity.id} className="flex flex-wrap items-center justify-between gap-space-md px-space-lg py-space-sm">
                <span className="flex items-center gap-space-md">
                  <MaterialIcon
                    name={
                      activity.status === 'COMPLETED'
                        ? 'check_circle'
                        : activity.status === 'FAILED'
                          ? 'cancel'
                          : activity.status === 'AT_RISK' || activity.status === 'GRACE_PERIOD'
                            ? 'warning'
                            : 'play_circle'
                    }
                    className={cn(
                      'text-[16px]',
                      activity.status === 'COMPLETED'
                        ? 'text-secondary'
                        : activity.status === 'FAILED'
                          ? 'text-error'
                          : 'text-on-surface-variant',
                    )}
                  />
                  <span className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-on-surface">{activity.user.fullName}</span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">
                      {activity.course.title} · attempt {activity.attemptNumber}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-space-md">
                  <Chip tone={activity.status === 'COMPLETED' ? 'earned' : activity.status === 'FAILED' ? 'risk' : 'info'}>
                    {statusLabel(activity.status)}
                  </Chip>
                  {activity.finalScore !== null ? (
                    <span className="font-mono text-label-xs tabular text-on-surface">{formatPercent(activity.finalScore, 1)}</span>
                  ) : null}
                  <span className="font-label-xs text-label-xs text-on-surface-variant">{formatRelative(activity.updatedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

