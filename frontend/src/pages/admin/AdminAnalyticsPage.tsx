import { useState } from 'react';
import { analyticsApi, adminApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider } from '../../components/ui/core';
import { Alert, Card, CardHeader, DataTable, EmptyState, ErrorBlock, LoadingBlock, MetricRow, Pagination, SectionHeader, StatCard, Tabs } from '../../components/ui/data';
import { Select } from '../../components/ui/forms';
import { BarList } from '../../components/domain/Charts';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDateTime, formatRelative, TRANSACTION_LABELS } from '../../utils/format';
import { cn } from '../../utils/cn';

type TabId = 'ledger' | 'reviews';

/** Platform-wide ledger and review moderation. */
export function AdminAnalyticsPage() {
  useDocumentTitle('Platform analytics');
  const toast = useToast();

  const [tab, setTab] = useState<TabId>('ledger');
  const [page, setPage] = useState(1);
  const [type, setType] = useState('ALL');

  const dashboard = useAsync(() => analyticsApi.adminDashboard(), []);
  const transactions = useAsync(
    () => analyticsApi.platformTransactions({ page, pageSize: 15, type: type === 'ALL' ? undefined : type }),
    [page, type],
  );
  const reviews = useAsync(() => adminApi.listReviews({ page: 1, pageSize: 20 }), []);
  const [moderatingId, setModeratingId] = useState<string | null>(null);

  const moderate = async (
    reviewId: string,
    action: { isFlagged?: boolean; flagReason?: string | null; isPublished?: boolean },
    label: string,
  ) => {
    setModeratingId(reviewId);
    try {
      await adminApi.moderateReview(reviewId, action);
      toast.success(label);
      await Promise.all([reviews.refetch(), dashboard.refetch()]);
    } catch (caught) {
      toast.error('Could not update the review', errorMessage(caught));
    } finally {
      setModeratingId(null);
    }
  };

  const data = dashboard.data;

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Analytics & moderation"
        meta={
          <Button variant="secondary" icon="refresh" onClick={() => void Promise.all([dashboard.refetch(), transactions.refetch(), reviews.refetch()])}>
            Refresh
          </Button>
        }
      />

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
            <StatCard
              label="Points awarded"
              value={data.economy.pointsAwarded}
              icon="trending_up"
              tone="success"
              hint="Across all settled attempts"
            />
            <StatCard
              label="Points forfeited"
              value={data.economy.pointsForfeited}
              icon="gavel"
              tone={data.economy.pointsForfeited > 0 ? 'risk' : 'neutral'}
              hint="Moved to the reward pool"
            />
            <StatCard
              label="Reward pool"
              value={data.economy.rewardPool.balance}
              icon="savings"
              hint={`in ${data.economy.rewardPool.totalIn} · out ${data.economy.rewardPool.totalOut}`}
            />
            <StatCard
              label="Flagged reviews"
              value={data.moderation.flaggedReviews}
              icon="flag"
              tone={data.moderation.flaggedReviews > 0 ? 'risk' : 'neutral'}
              hint="Awaiting moderation"
            />
          </div>

          <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Economy breakdown" subtitle="Where platform points currently sit" />
              <Divider />
              <div className="p-space-lg">
                <BarList
                  data={[
                    { label: 'Spendable balances', value: data.economy.wallet.totalAvailable, tone: 'primary' },
                    { label: 'Locked in stakes', value: data.economy.wallet.totalLocked, tone: 'muted' },
                    { label: 'Reward pool', value: data.economy.rewardPool.balance, tone: 'success' },
                  ]}
                  unit=" pts"
                />
              </div>
              <Divider />
              <div className="grid grid-cols-2 gap-space-md p-space-lg">
                <MetricRow label="Wallet accounts" value={String(data.economy.wallet.totalAccounts)} />
                <MetricRow label="Average balance" value={`${data.economy.wallet.averageBalance} pts`} />
                <MetricRow label="Pool last updated" value={formatDateTime(data.economy.rewardPool.updatedAt)} />
                <MetricRow label="Users" value={`${data.users.total} (${data.users.learners} learners)`} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Attempt status mix" />
              <Divider />
              <div className="p-space-lg">
                <BarList
                  data={Object.entries(data.attempts).map(([status, entry]) => ({
                    label: status.replace(/_/g, ' ').toLowerCase(),
                    value: entry.count,
                    tone: status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'risk' : 'primary',
                  }))}
                  emptyLabel="No attempts yet"
                />
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <Tabs
        tabs={[
          { id: 'ledger', label: 'Point ledger' },
          { id: 'reviews', label: 'Review moderation', count: data?.moderation.flaggedReviews },
        ]}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      {tab === 'ledger' ? (
        <Card>
          <CardHeader
            title="Platform-wide point ledger"
            subtitle="Every movement across every wallet"
            action={
              <Select
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: 'ALL', label: 'All types' },
                  ...Object.entries(TRANSACTION_LABELS).map(([value, label]) => ({ value, label })),
                ]}
                className="w-56"
              />
            }
          />
          <Divider />
          {transactions.error ? (
            <ErrorBlock message={transactions.error} onRetry={() => void transactions.refetch()} />
          ) : (
            <>
              <DataTable
                loading={transactions.loading}
                rows={transactions.data?.items ?? []}
                keyFor={(row) => row.id}
                empty={<EmptyState icon="receipt_long" title="No transactions match" />}
                columns={[
                  {
                    key: 'user',
                    header: 'Account',
                    render: (row) => (
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-on-surface">{row.user.fullName}</span>
                        <span className="font-label-xs text-label-xs text-on-surface-variant">
                          {row.user.email} · {row.user.role}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (row) => (
                      <Chip tone={row.amount > 0 ? 'earned' : 'risk'}>
                        {TRANSACTION_LABELS[row.type] ?? row.type}
                      </Chip>
                    ),
                  },
                  {
                    key: 'description',
                    header: 'Description',
                    render: (row) => (
                      <span className="font-body-sm text-body-sm text-on-surface-variant">{row.description}</span>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    align: 'right',
                    render: (row) => (
                      <span className={cn('font-mono text-label-md tabular', row.amount > 0 ? 'text-secondary' : 'text-error')}>
                        {row.amount > 0 ? '+' : '−'}
                        {Math.abs(row.amount)}
                      </span>
                    ),
                  },
                  {
                    key: 'balance',
                    header: 'Balance after',
                    align: 'right',
                    render: (row) => <span className="font-mono text-label-sm tabular text-on-surface-variant">{row.balanceAfter}</span>,
                  },
                  {
                    key: 'when',
                    header: 'When',
                    align: 'right',
                    render: (row) => <span className="font-label-xs text-label-xs text-on-surface-variant">{formatRelative(row.createdAt)}</span>,
                  },
                ]}
              />
              {transactions.data ? (
                <Pagination
                  page={transactions.data.pagination.page}
                  totalPages={transactions.data.pagination.totalPages}
                  total={transactions.data.pagination.total}
                  onPageChange={setPage}
                  className="border-t border-outline-variant"
                />
              ) : null}
            </>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Review moderation"
            subtitle="Flag, unpublish or restore learner reviews"
          />
          <Divider />
          {reviews.error ? (
            <ErrorBlock message={reviews.error} onRetry={() => void reviews.refetch()} />
          ) : reviews.loading ? (
            <LoadingBlock label="Loading reviews…" rows={3} />
          ) : (reviews.data?.items.length ?? 0) === 0 ? (
            <EmptyState icon="reviews" title="No reviews yet" description="Learner reviews appear here once courses are completed." />
          ) : (
            <div className="flex flex-col divide-y divide-outline-variant">
              {reviews.data!.items.map((review) => (
                <div key={review.id} className="flex flex-col gap-space-sm px-space-lg py-space-md">
                  <div className="flex flex-wrap items-start justify-between gap-space-md">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-label-md text-label-md text-on-surface">
                        {review.user.fullName} · {review.rating}/5
                        {review.difficultyRating ? ` · difficulty ${review.difficultyRating}/5` : ''}
                      </span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {review.course.title} · {formatRelative(review.createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-space-xs">
                      {review.isFlagged ? <Chip tone="risk">flagged</Chip> : null}
                      {!review.isPublished ? <Chip tone="locked">unpublished</Chip> : null}
                      {review.wouldRecommend ? <Chip tone="earned">recommends</Chip> : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={review.isFlagged ? 'flag' : 'outlined_flag'}
                        loading={moderatingId === review.id}
                        onClick={() => void moderate(review.id, { isFlagged: !review.isFlagged, flagReason: review.isFlagged ? null : 'Flagged by administrator' }, review.isFlagged ? 'Flag removed' : 'Review flagged')}
                      >
                        {review.isFlagged ? 'Unflag' : 'Flag'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={review.isPublished ? 'visibility_off' : 'visibility'}
                        loading={moderatingId === review.id}
                        onClick={() => void moderate(review.id, { isPublished: !review.isPublished }, review.isPublished ? 'Review hidden' : 'Review published')}
                      >
                        {review.isPublished ? 'Hide' : 'Publish'}
                      </Button>
                    </div>
                  </div>
                  {review.reviewText ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">{review.reviewText}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Alert tone="info" icon="info">
        Hiding a review removes it from the course page and from instructor reputation calculations, but the row is kept so the
        moderation history stays intact.
      </Alert>
    </div>
  );
}


