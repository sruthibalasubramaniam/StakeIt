import { useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsApi, courseApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip } from '../../components/ui/core';
import { Card, ConfirmDialog, DataTable, EmptyState, ErrorBlock, SectionHeader, Tabs } from '../../components/ui/data';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDate, statusLabel } from '../../utils/format';
import type { CourseSummary } from '../../types/api';

type StatusFilter = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/** Instructor course list with publish / unpublish / archive / delete actions. */
export function InstructorCoursesPage() {
  useDocumentTitle('My courses');
  const toast = useToast();

  const courses = useAsync(() => analyticsApi.instructorCourses(), []);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseSummary | null>(null);

  const rows = (courses.data ?? []).filter((course) => status === 'ALL' || course.status === status);
  const countFor = (value: StatusFilter) =>
    value === 'ALL' ? (courses.data?.length ?? 0) : (courses.data ?? []).filter((course) => course.status === value).length;

  const run = async (action: 'publish' | 'unpublish' | 'archive', course: CourseSummary) => {
    setBusyId(course.id);
    try {
      if (action === 'publish') await courseApi.publish(course.id);
      if (action === 'unpublish') await courseApi.unpublish(course.id);
      if (action === 'archive') await courseApi.archive(course.id);
      toast.success(`Course ${action === 'unpublish' ? 'unpublished' : action + 'ed'}`, course.title);
      await courses.refetch();
    } catch (caught) {
      // Publish failures are actionable (missing final test, bad weights, …).
      toast.error(`Could not ${action} course`, errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await courseApi.remove(deleteTarget.id);
      toast.success('Course deleted', deleteTarget.title);
      setDeleteTarget(null);
      await courses.refetch();
    } catch (caught) {
      toast.error('Could not delete course', errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Instructor protocol"
        title="My courses"
        meta={
          <Link to="/instructor/courses/create">
            <Button icon="add">Create course</Button>
          </Link>
        }
      />

      <Tabs
        tabs={[
          { id: 'ALL', label: 'All', count: countFor('ALL') },
          { id: 'DRAFT', label: 'Drafts', count: countFor('DRAFT') },
          { id: 'PUBLISHED', label: 'Published', count: countFor('PUBLISHED') },
          { id: 'ARCHIVED', label: 'Archived', count: countFor('ARCHIVED') },
        ]}
        active={status}
        onChange={(id) => setStatus(id as StatusFilter)}
      />

      <Card>
        {courses.error ? (
          <ErrorBlock message={courses.error} onRetry={() => void courses.refetch()} />
        ) : (
          <DataTable<CourseSummary>
            loading={courses.loading}
            rows={rows}
            keyFor={(row) => row.id}
            empty={
              <EmptyState
                icon="library_books"
                title={status === 'ALL' ? 'No courses yet' : `No ${status.toLowerCase()} courses`}
                description="Build a course with modules, quizzes and assessments, then publish it so learners can stake points on it."
                action={
                  <Link to="/instructor/courses/create">
                    <Button icon="add">Create your first course</Button>
                  </Link>
                }
              />
            }
            columns={[
              {
                key: 'course',
                header: 'Course',
                render: (row) => (
                  <div className="flex flex-col gap-0.5">
                    <Link to={`/courses/${row.slug}`} className="font-label-md text-label-md text-on-surface hover:text-primary">
                      {row.title}
                    </Link>
                    <span className="flex items-center gap-space-sm font-label-xs text-label-xs text-on-surface-variant">
                      <span className="font-mono">{row.code}</span>
                      <span>·</span>
                      <span>{row.category}</span>
                      <span>·</span>
                      <span>{row.moduleCount} module(s)</span>
                    </span>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Chip tone={row.status === 'PUBLISHED' ? 'earned' : row.status === 'DRAFT' ? 'info' : 'locked'}>
                    {statusLabel(row.status)}
                  </Chip>
                ),
              },
              {
                key: 'economics',
                header: 'Stake / reward',
                align: 'right',
                render: (row) => (
                  <span className="font-mono text-label-sm tabular text-on-surface">
                    {row.baseStake} / {row.completionReward}
                  </span>
                ),
              },
              { key: 'learners', header: 'Learners', align: 'right', render: (row) => <span className="metric">{row.learnerCount ?? 0}</span> },
              {
                key: 'updated',
                header: 'Updated',
                align: 'right',
                render: (row) => <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(row.updatedAt)}</span>,
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (row) => (
                  <div className="flex items-center justify-end gap-space-xs">
                    <Link to={`/instructor/courses/${row.id}/builder`} title="Open builder">
                      <Button size="sm" variant="secondary" icon="edit">
                        Build
                      </Button>
                    </Link>
                    <Link to={`/instructor/courses/${row.id}/learners`} title="Learners">
                      <Button size="sm" variant="ghost" icon="group">
                        {''}
                      </Button>
                    </Link>
                    <Link to={`/instructor/courses/${row.id}/analytics`} title="Analytics">
                      <Button size="sm" variant="ghost" icon="insights">
                        {''}
                      </Button>
                    </Link>
                    {row.status === 'PUBLISHED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="visibility_off"
                        loading={busyId === row.id}
                        onClick={() => void run('unpublish', row)}
                        title="Unpublish"
                      >
                        {''}
                      </Button>
                    ) : row.status === 'DRAFT' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="publish"
                        loading={busyId === row.id}
                        onClick={() => void run('publish', row)}
                        title="Publish"
                      >
                        {''}
                      </Button>
                    ) : null}
                    {row.status !== 'PUBLISHED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="delete"
                        onClick={() => setDeleteTarget(row)}
                        title="Delete"
                        className="text-error"
                      >
                        {''}
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-space-md">
        <Chip tone="info" icon="info">
          Publish is gated
        </Chip>
        <span className="font-label-xs text-label-xs text-on-surface-variant">
          A course cannot go live until it has at least one module with required content, a final assessment with questions, and
          weights that total exactly 100%. The API rejects an incomplete publish and explains what is missing.
        </span>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this course?"
        message="Deletion is only permitted for courses with no enrolment history. Courses that have ever been staked on must be archived instead so the ledger stays auditable."
        confirmLabel="Delete course"
        destructive
        pending={busyId === deleteTarget?.id}
      />
    </div>
  );
}


