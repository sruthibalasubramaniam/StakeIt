import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/endpoints';
import { useAsync, useDebounced, useDocumentTitle } from '../../hooks';
import { Button, Chip } from '../../components/ui/core';
import { Card, DataTable, EmptyState, ErrorBlock, Pagination, SectionHeader } from '../../components/ui/data';
import { Input, Select } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatPercent } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { BadgeTier, PublicUser } from '../../types/api';

type InstructorRow = PublicUser & {
  courseCount: number;
  badge: string;
  metrics: Record<string, number>;
  eligibleTier: string;
};

/** Instructor roster with reputation metrics and manual badge control. */
export function AdminInstructorsPage() {
  useDocumentTitle('Instructors');
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search, 350);

  const instructors = useAsync(
    () => adminApi.listInstructors({ q: debounced.trim() || undefined, page, pageSize: 15 }),
    [debounced, page],
  );

  const recompute = async () => {
    try {
      const result = await adminApi.recomputeReputation();
      toast.success('Reputation recomputed', `${result.instructorsProcessed} instructor(s) evaluated.`);
      await instructors.refetch();
    } catch (caught) {
      toast.error('Could not recompute reputation', errorMessage(caught));
    }
  };

  const setBadge = async (row: InstructorRow, tier: BadgeTier) => {
    try {
      await adminApi.awardBadge(row.id, { tier, notes: 'Manual administrator adjustment' });
      toast.success(tier === 'NONE' ? 'Badge revoked' : `${tier} badge applied`, row.fullName);
      await instructors.refetch();
    } catch (caught) {
      toast.error('Could not update badge', errorMessage(caught));
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Instructors"
        meta={
          <div className="flex items-center gap-space-sm">
            <Button variant="secondary" icon="refresh" onClick={() => void recompute()}>
              Recompute reputation
            </Button>
            <Link to="/admin/badges">
              <Button variant="secondary" icon="military_tech">
                Badges
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <span className="micro-label text-on-surface-variant">
          {instructors.data?.pagination.total ?? 0} instructor account(s)
        </span>
        <Input
          icon="search"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-72"
        />
      </div>

      <Card>
        {instructors.error ? (
          <ErrorBlock message={instructors.error} onRetry={() => void instructors.refetch()} />
        ) : (
          <>
            <DataTable<InstructorRow>
              loading={instructors.loading}
              rows={instructors.data?.items ?? []}
              keyFor={(row) => row.id}
              empty={<EmptyState icon="badge" title="No instructors yet" />}
              columns={[
                {
                  key: 'instructor',
                  header: 'Instructor',
                  render: (row) => (
                    <div className="flex flex-col gap-0.5">
                      <Link to={`/instructors/${row.id}`} className="font-label-md text-label-md text-on-surface hover:text-primary">
                        {row.fullName}
                      </Link>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">{row.email}</span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">{row.courseCount} course(s)</span>
                    </div>
                  ),
                },
                {
                  key: 'outcomes',
                  header: 'Settled outcomes',
                  align: 'right',
                  render: (row) => (
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-label-md tabular text-on-surface">
                        {row.metrics.learnerOutcomes ?? 0}
                      </span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {(row.metrics.distinctLearners ?? 0) as number} distinct learner(s)
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'rates',
                  header: 'Rates',
                  align: 'right',
                  render: (row) => (
                    <div className="flex flex-col items-end font-label-xs text-label-xs text-on-surface-variant">
                      <span>completion {formatPercent((row.metrics.completionRate ?? 0) * 100)}</span>
                      <span>commitment {formatPercent((row.metrics.commitmentSuccessRate ?? 0) * 100)}</span>
                    </div>
                  ),
                },
                {
                  key: 'quality',
                  header: 'Quality',
                  align: 'right',
                  render: (row) => (
                    <div className="flex flex-col items-end">
                      <span className={cn('font-mono text-label-md tabular', (row.metrics.averageScore ?? 0) >= 75 ? 'text-secondary' : 'text-on-surface')}>
                        {(row.metrics.averageScore ?? 0) > 0 ? formatPercent(row.metrics.averageScore!, 1) : '—'}
                      </span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {(row.metrics.averageRating ?? 0) > 0 ? `${(row.metrics.averageRating ?? 0).toFixed(1)}/5` : 'no ratings'}
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'reputation',
                  header: 'Reputation',
                  render: (row) => (
                    <div className="flex flex-col gap-0.5">
                      <Chip tone={row.badge === 'GOLD' ? 'earned' : row.badge === 'SILVER' ? 'info' : row.badge === 'BRONZE' ? 'neutral' : 'locked'}>
                        {row.badge.toLowerCase()}
                      </Chip>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        score {row.metrics.compositeScore ?? 0} · eligible {row.eligibleTier.toLowerCase()}
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'badge',
                  header: 'Set badge',
                  render: (row) => (
                    <Select
                      value={row.badge}
                      onChange={(event) => void setBadge(row, event.target.value as BadgeTier)}
                      options={[
                        { value: 'NONE', label: 'None (revoke)' },
                        { value: 'BRONZE', label: 'Bronze' },
                        { value: 'SILVER', label: 'Silver' },
                        { value: 'GOLD', label: 'Gold' },
                      ]}
                      className="w-36"
                    />
                  ),
                },
              ]}
            />

            {instructors.data ? (
              <Pagination
                page={instructors.data.pagination.page}
                totalPages={instructors.data.pagination.totalPages}
                total={instructors.data.pagination.total}
                onPageChange={setPage}
                className="border-t border-outline-variant"
              />
            ) : null}
          </>
        )}
      </Card>

      <p className="font-label-xs text-label-xs text-on-surface-variant">
        Badges are computed automatically from learner outcomes and gated by a minimum sample size; the selector here is an
        explicit administrator override that is recorded against your account.
      </p>
    </div>
  );
}
