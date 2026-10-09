import { useState } from 'react';
import { Link } from 'react-router-dom';
import { stakeApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Chip, MaterialIcon } from '../../components/ui/core';
import { Card, CardHeader, DataTable, EmptyState, ErrorBlock, Pagination, SectionHeader, StatCard, Tabs } from '../../components/ui/data';
import { formatCountdown, formatDate, formatPoints, statusLabel } from '../../utils/format';
import type { StakeRow } from '../../types/api';

type TabId = 'LOCKED' | 'RETURNED' | 'FORFEITED' | 'ALL';

const TONE_BY_STATUS: Record<string, 'stake' | 'earned' | 'risk'> = {
  LOCKED: 'stake',
  RETURNED: 'earned',
  FORFEITED: 'risk',
};

/** Stake ledger: what is at risk, what came back, and what was lost. */
export function StakesPage() {
  useDocumentTitle('Stakes');

  const [tab, setTab] = useState<TabId>('ALL');
  const [page, setPage] = useState(1);

  const stakes = useAsync(
    () => stakeApi.list({ status: tab === 'ALL' ? undefined : tab, page, pageSize: 15 }),
    [tab, page],
  );

  const totals = stakes.data?.totals;

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        title="Stakes"
        meta={
          <span className="flex items-baseline gap-1.5">
            <span className="micro-label text-on-surface-variant">Currently locked:</span>
            <span className="font-mono text-label-md tabular text-on-surface">
              {formatPoints(totals?.lockedPoints ?? 0, { suffix: false })} pts
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard
          label="Locked"
          value={totals?.lockedPoints ?? 0}
          icon="lock"
          tone="primary"
          hint={`${totals?.lockedCount ?? 0} active stake(s)`}
        />
        <StatCard
          label="Returned"
          value={totals?.returnedPoints ?? 0}
          icon="undo"
          tone="success"
          hint={`${totals?.returnedCount ?? 0} returned stake(s)`}
        />
        <StatCard
          label="Forfeited"
          value={totals?.forfeitedPoints ?? 0}
          icon="gavel"
          tone={(totals?.forfeitedPoints ?? 0) > 0 ? 'risk' : 'neutral'}
          hint={`${totals?.forfeitedCount ?? 0} failed attempt(s)`}
        />
        <StatCard
          label="Net position"
          value={(totals?.returnedPoints ?? 0) - (totals?.forfeitedPoints ?? 0)}
          icon="balance"
          hint="Returned minus forfeited"
        />
      </div>

      <Tabs
        tabs={[
          { id: 'ALL', label: 'All' },
          { id: 'LOCKED', label: 'Locked' },
          { id: 'RETURNED', label: 'Returned' },
          { id: 'FORFEITED', label: 'Forfeited' },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id as TabId);
          setPage(1);
        }}
      />

      <Card>
        {stakes.error ? (
          <ErrorBlock message={stakes.error} onRetry={() => void stakes.refetch()} />
        ) : (
          <>
            <DataTable<StakeRow>
              loading={stakes.loading}
              rows={stakes.data?.items ?? []}
              keyFor={(row) => row.id}
              empty={
                <EmptyState
                  icon="lock_open"
                  title={tab === 'ALL' ? 'No stakes yet' : `No ${tab.toLowerCase()} stakes`}
                  description="Stakes appear here as soon as you enrol in a course and commit points."
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
              }
              columns={[
                {
                  key: 'course',
                  header: 'Course',
                  render: (row) => (
                    <div className="flex flex-col">
                      <Link to={`/courses/${row.course.slug}`} className="font-label-md text-label-md text-on-surface hover:text-primary">
                        {row.course.title}
                      </Link>
                      <span className="font-mono text-label-xs text-on-surface-variant">{row.course.code}</span>
                    </div>
                  ),
                },
                {
                  key: 'type',
                  header: 'Type',
                  render: (row) => (
                    <div className="flex flex-col gap-0.5">
                      <Chip tone={row.type === 'BASE' ? 'stake' : 'info'}>
                        {row.type === 'BASE' ? 'base stake' : 'commitment'}
                      </Chip>
                      {row.commitment ? (
                        <span className="font-label-xs text-label-xs text-on-surface-variant">{row.commitment.label}</span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => (
                    <div className="flex flex-col gap-0.5">
                      <Chip tone={TONE_BY_STATUS[row.status] ?? 'neutral'}>{statusLabel(row.status)}</Chip>
                      {row.status === 'RETURNED' ? (
                        <span className="font-label-xs text-label-xs text-secondary">
                          +{row.returnedAmount} returned
                        </span>
                      ) : null}
                      {row.status === 'FORFEITED' ? (
                        <span className="font-label-xs text-label-xs text-error">to reward pool</span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  render: (row) => (
                    <span className="font-mono tabular text-on-surface">{formatPoints(row.amount, { suffix: false })}</span>
                  ),
                },
                {
                  key: 'attempt',
                  header: 'Attempt',
                  render: (row) => (
                    <div className="flex flex-col">
                      <span className="font-mono text-label-xs tabular text-on-surface-variant">
                        #{row.attempt.attemptNumber}
                      </span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {statusLabel(row.attempt.status)}
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'dates',
                  header: 'Timeline',
                  render: (row) => (
                    <div className="flex flex-col">
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        Staked {formatDate(row.lockedAt)}
                      </span>
                      {row.settledAt ? (
                        <span className="font-label-xs text-label-xs text-on-surface-variant">
                          Settled {formatDate(row.settledAt)}
                        </span>
                      ) : (
                        <span className="font-label-xs text-label-xs text-on-surface-variant">
                          {formatCountdown(row.attempt.normalDeadline)}
                        </span>
                      )}
                    </div>
                  ),
                },
              ]}
            />

            {stakes.data ? (
              <Pagination
                page={stakes.data.pagination.page}
                totalPages={stakes.data.pagination.totalPages}
                total={stakes.data.pagination.total}
                onPageChange={setPage}
                className="border-t border-outline-variant"
              />
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="How stakes settle" />
        <div className="flex flex-col gap-space-xs px-space-lg pb-space-lg">
          {[
            'Locked — points are in escrow while the attempt is active.',
            'Returned — the course completed, so the stake came back to your available balance.',
            'Forfeited — the normal deadline passed without verified completion. Those points went to the platform reward pool.',
            'Forfeited points are never transferred directly to another learner.',
          ].map((line) => (
            <span key={line} className="flex items-start gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
              <MaterialIcon name="rule" className="mt-0.5 shrink-0 text-[15px]" />
              {line}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

