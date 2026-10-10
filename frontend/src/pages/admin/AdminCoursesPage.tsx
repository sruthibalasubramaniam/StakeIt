import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, courseApi } from '../../services/endpoints';
import { useAsync, useDebounced, useDocumentTitle } from '../../hooks';
import { Button, Chip } from '../../components/ui/core';
import { Card, DataTable, EmptyState, ErrorBlock, Pagination, SectionHeader, Tabs } from '../../components/ui/data';
import { Input } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDate, statusLabel } from '../../utils/format';
import type { CourseSummary } from '../../types/api';

type AdminCourseRow = CourseSummary & {
  instructor: { id: string; fullName: string; email: string };
  _count: { enrollments: number; modules: number; attempts: number };
};

type StatusFilter = 'ALL' | 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';

/** Platform-wide course administration. */
export function AdminCoursesPage() {
  useDocumentTitle('All courses');
  const toast = useToast();

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search, 350);

  const courses = useAsync(
    () =>
      adminApi.listCourses({
        status: status === 'ALL' ? undefined : status,
        q: debounced.trim() || undefined,
        page,
        pageSize: 15,
      }),
    [status, debounced, page],
  );

  const moderate = async (row: AdminCourseRow, action: 'publish' | 'unpublish' | 'archive') => {
    try {
      if (action === 'publish') await courseApi.publish(row.id);
      if (action === 'unpublish') await courseApi.unpublish(row.id);
      if (action === 'archive') await courseApi.archive(row.id);
      toast.success(`Course ${action === 'unpublish' ? 'unpublished' : `${action}d`}`, row.title);
      await courses.refetch();
    } catch (caught) {
      toast.error(`Could not ${action} course`, errorMessage(caught));
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Courses"
        meta={
          <div className="flex items-center gap-space-md">
            <span className="flex items-baseline gap-1.5">
              <span className="micro-label text-on-surface-variant">Total:</span>
              <span className="font-mono text-label-md tabular text-on-surface">{courses.data?.pagination.total ?? 0}</span>
            </span>
            <Link to="/admin/courses/create">
              <Button icon="add" size="sm">
                Create course
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <Tabs
          tabs={[
            { id: 'ALL', label: 'All' },
            { id: 'PUBLISHED', label: 'Published' },
            { id: 'DRAFT', label: 'Drafts' },
            { id: 'ARCHIVED', label: 'Archived' },
          ]}
          active={status}
          onChange={(id) => {
            setStatus(id as StatusFilter);
            setPage(1);
          }}
        />
        <Input
          icon="search"
          placeholder="Search title or code"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-72"
        />
      </div>

      <Card>
        {courses.error ? (
          <ErrorBlock message={courses.error} onRetry={() => void courses.refetch()} />
        ) : (
          <>
            <DataTable<AdminCourseRow>
              loading={courses.loading}
              rows={courses.data?.items ?? []}
              keyFor={(row) => row.id}
              empty={<EmptyState icon="library_books" title="No courses match" />}
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
                        <span>· {row.category}</span>
                        <Chip tone={row.status === 'PUBLISHED' ? 'earned' : row.status === 'DRAFT' ? 'info' : 'locked'}>
                          {statusLabel(row.status)}
                        </Chip>
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'instructor',
                  header: 'Instructor',
                  render: (row) => (
                    <div className="flex flex-col">
                      <Link to={`/instructors/${row.instructor.id}`} className="font-label-sm text-label-sm text-on-surface hover:text-primary">
                        {row.instructor.fullName}
                      </Link>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">{row.instructor.email}</span>
                    </div>
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
                {
                  key: 'activity',
                  header: 'Activity',
                  align: 'right',
                  render: (row) => (
                    <div className="flex flex-col items-end font-label-xs text-label-xs text-on-surface-variant">
                      <span>{row._count.enrollments} enrolment(s)</span>
                      <span>{row._count.attempts} attempt(s) · {row._count.modules} module(s)</span>
                    </div>
                  ),
                },
                {
                  key: 'updated',
                  header: 'Updated',
                  align: 'right',
                  render: (row) => <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(row.updatedAt)}</span>,
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <div className="flex items-center justify-end gap-space-xs">
                      {/* Admin-scoped authoring routes — an administrator never
                          leaves the /admin surface. */}
                      <Link to={`/admin/courses/${row.id}/builder`}>
                        <Button size="sm" variant="secondary" icon="construction">
                          Builder
                        </Button>
                      </Link>
                      <Link to={`/admin/courses/${row.id}/learners`}>
                        <Button size="sm" variant="ghost" icon="group">
                          {''}
                        </Button>
                      </Link>
                      <Link to={`/admin/courses/${row.id}/analytics`}>
                        <Button size="sm" variant="ghost" icon="insights">
                          {''}
                        </Button>
                      </Link>
                      {row.status === 'PUBLISHED' ? (
                        <Button size="sm" variant="ghost" icon="visibility_off" onClick={() => void moderate(row, 'unpublish')}>
                          {''}
                        </Button>
                      ) : row.status === 'DRAFT' ? (
                        <Button size="sm" variant="ghost" icon="publish" onClick={() => void moderate(row, 'publish')}>
                          {''}
                        </Button>
                      ) : null}
                      {row.status !== 'PUBLISHED' ? (
                        <Button size="sm" variant="ghost" icon="archive" onClick={() => void moderate(row, 'archive')}>
                          {''}
                        </Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />

            {courses.data ? (
              <Pagination
                page={courses.data.pagination.page}
                totalPages={courses.data.pagination.totalPages}
                total={courses.data.pagination.total}
                onPageChange={setPage}
                className="border-t border-outline-variant"
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
