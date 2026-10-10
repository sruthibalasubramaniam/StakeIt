import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, courseApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, DataTable, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatCard } from '../../components/ui/data';
import { SearchInput } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { useCourseAreaBase } from '../../router/routeAccess';
import { formatDate, formatPercent, formatPoints, statusLabel } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { CourseAnalytics } from '../../types/api';

type LearnerRow = CourseAnalytics['learners'][number];

/** Enrolled learners for one course, with the exceptional-case actions. */
export function CourseLearnersPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const toast = useToast();
  useDocumentTitle('Course learners');
  const areaBase = useCourseAreaBase();

  const analytics = useAsync(() => courseApi.analytics(courseId), [courseId]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (analytics.loading) return <LoadingBlock label="Loading learners…" rows={5} />;
  if (analytics.error || !analytics.data) {
    return <ErrorBlock title="Could not load learners" message={analytics.error} onRetry={() => void analytics.refetch()} />;
  }

  const { course, overview, learners } = analytics.data;
  const filtered = learners.filter((row) => {
    if (!query.trim()) return true;
    const term = query.trim().toLowerCase();
    return row.learner.fullName.toLowerCase().includes(term) || row.learner.email.toLowerCase().includes(term);
  });

  const extendDeadline = async (row: LearnerRow) => {
    setBusyId(row.attemptId);
    try {
      await adminApi.extendDeadline(row.attemptId, { days: 7, reason: 'Instructor-approved extension' });
      toast.success('Deadline extended', `7 days added for ${row.learner.fullName}.`);
      await analytics.refetch();
    } catch (caught) {
      toast.error('Could not extend the deadline', errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

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
          <Link to={`${areaBase}/${courseId}/analytics`}>
            <Button variant="secondary" icon="insights">
              Analytics
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard label="Attempts" value={overview.enrolled} icon="group" />
        <StatCard label="Active" value={overview.active} icon="play_circle" tone="primary" />
        <StatCard label="Completed" value={overview.completed} icon="task_alt" tone="success" />
        <StatCard
          label="At risk"
          value={overview.atRisk}
          icon="warning"
          tone={overview.atRisk > 0 ? 'risk' : 'neutral'}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-space-md p-space-lg">
          <span className="micro-label text-on-surface-variant">
            {filtered.length} of {learners.length} learner attempt(s)
          </span>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name or email"
            className="w-full sm:w-72"
          />
        </div>

        <DataTable<LearnerRow>
          rows={filtered}
          keyFor={(row) => row.attemptId}
          empty={<EmptyState icon="group_off" title="No learners match" description="Try a different search term." />}
          columns={[
            {
              key: 'learner',
              header: 'Learner',
              render: (row) => (
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-on-surface">{row.learner.fullName}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">{row.learner.email}</span>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <div className="flex flex-col gap-0.5">
                  <Chip
                    tone={
                      row.status === 'COMPLETED'
                        ? 'earned'
                        : row.status === 'FAILED'
                          ? 'risk'
                          : row.status === 'AT_RISK' || row.status === 'GRACE_PERIOD'
                            ? 'risk'
                            : 'info'
                    }
                  >
                    {statusLabel(row.status)}
                  </Chip>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">attempt #{row.attemptNumber}</span>
                </div>
              ),
            },
            {
              key: 'scores',
              header: 'Scores',
              align: 'right',
              render: (row) => (
                <div className="flex flex-col items-end">
                  <span className={cn('font-mono text-label-md tabular', (row.finalScore ?? 0) >= 70 ? 'text-secondary' : 'text-on-surface')}>
                    {row.finalScore !== null ? formatPercent(row.finalScore, 1) : '—'}
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    module {row.moduleScore !== null ? formatPercent(row.moduleScore, 0) : '—'} · test{' '}
                    {row.finalTestScore !== null ? formatPercent(row.finalTestScore, 0) : '—'}
                  </span>
                </div>
              ),
            },
            {
              key: 'commitment',
              header: 'Commitment',
              render: (row) => {
                const hasCommitment = row.stakes.some((stake) => stake.type === 'COMMITMENT');
                if (!hasCommitment) return <span className="font-label-xs text-label-xs text-on-surface-variant">—</span>;
                return (
                  <Chip tone={row.commitmentMet ? 'earned' : 'risk'}>
                    {row.commitmentMet ? 'met' : row.commitmentMet === false ? 'missed' : 'in flight'}
                  </Chip>
                );
              },
            },
            {
              key: 'points',
              header: 'Points',
              align: 'right',
              render: (row) => (
                <div className="flex flex-col items-end">
                  {row.pointsAwarded > 0 ? (
                    <span className="font-mono text-label-sm tabular text-secondary">+{formatPoints(row.pointsAwarded, { suffix: false })}</span>
                  ) : null}
                  {row.pointsForfeited > 0 ? (
                    <span className="font-mono text-label-sm tabular text-error">−{formatPoints(row.pointsForfeited, { suffix: false })}</span>
                  ) : null}
                  {row.pointsAwarded === 0 && row.pointsForfeited === 0 ? (
                    <span className="font-label-xs text-label-xs text-on-surface-variant">in escrow</span>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'dates',
              header: 'Timeline',
              render: (row) => (
                <div className="flex flex-col">
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    Started {formatDate(row.startedAt)}
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {row.completedAt
                      ? `Completed ${formatDate(row.completedAt)}`
                      : row.failedAt
                        ? `Failed ${formatDate(row.failedAt)}`
                        : 'In progress'}
                  </span>
                </div>
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) =>
                row.status === 'ACTIVE' || row.status === 'AT_RISK' || row.status === 'GRACE_PERIOD' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="event_repeat"
                    loading={busyId === row.attemptId}
                    onClick={() => void extendDeadline(row)}
                  >
                    +7 days
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Alert tone="info" icon="info">
        Extending a deadline is an administrative action. It shifts both the normal deadline and the grace period, and the learner
        is notified with the reason you supply.
      </Alert>
    </div>
  );
}
