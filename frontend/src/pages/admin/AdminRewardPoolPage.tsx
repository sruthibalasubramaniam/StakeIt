import { useState } from 'react';
import { adminApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Divider } from '../../components/ui/core';
import { Alert, Card, CardHeader, DataTable, EmptyState, ErrorBlock, LoadingBlock, MetricRow, Modal, Pagination, SectionHeader, StatCard } from '../../components/ui/data';
import { Input } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDateTime, formatPoints } from '../../utils/format';
import { cn } from '../../utils/cn';

/** Platform reward pool: funded by forfeited stakes, audited end to end. */
export function AdminRewardPoolPage() {
  useDocumentTitle('Reward pool');
  const toast = useToast();

  const [page, setPage] = useState(1);
  const pool = useAsync(() => adminApi.rewardPool({ page, pageSize: 20 }), [page]);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const submitAdjustment = async () => {
    if (!reason.trim() || amount === 0) return;
    setAdjusting(true);
    try {
      await adminApi.adjustRewardPool({ amount, reason: reason.trim() });
      toast.success('Pool adjusted', `${amount > 0 ? '+' : ''}${amount} points.`);
      setAdjustOpen(false);
      setReason('');
      await pool.refetch();
    } catch (caught) {
      toast.error('Could not adjust the pool', errorMessage(caught));
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Reward pool"
        meta={
          <Button icon="tune" onClick={() => setAdjustOpen(true)}>
            Adjust pool
          </Button>
        }
      />

      {pool.error ? (
        <ErrorBlock message={pool.error} onRetry={() => void pool.refetch()} />
      ) : pool.loading || !pool.data ? (
        <LoadingBlock label="Loading reward pool…" rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
            <StatCard
              label="Pool balance"
              value={formatPoints(pool.data.pool.balance, { suffix: false })}
              icon="savings"
              tone="success"
              hint="Available to fund platform rewards"
            />
            <StatCard
              label="Total forfeited in"
              value={formatPoints(pool.data.pool.totalIn, { suffix: false })}
              icon="gavel"
              hint="From failed attempts"
            />
            <StatCard
              label="Total paid out"
              value={formatPoints(pool.data.pool.totalOut, { suffix: false })}
              icon="payments"
              hint="Platform-funded rewards"
            />
            <StatCard
              label="Net position"
              value={formatPoints(pool.data.pool.totalIn - pool.data.pool.totalOut, { suffix: false })}
              icon="balance"
              hint="In minus out"
            />
          </div>

          <Alert tone="info" icon="info">
            Forfeited stakes are credited here and are <strong>never</strong> transferred directly to another learner. Any payout
            is an explicit, audited platform reward or administrator adjustment.
          </Alert>

          <Card>
            <CardHeader title="Pool transaction history" subtitle="Every movement in and out of the pool" />
            <Divider />
            <DataTable
              rows={pool.data.transactions.items}
              keyFor={(row) => row.id}
              empty={<EmptyState icon="receipt_long" title="No pool transactions yet" />}
              columns={[
                {
                  key: 'description',
                  header: 'Description',
                  render: (row) => (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-label-sm text-label-sm text-on-surface">{row.description}</span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {row.type.replace(/_/g, ' ').toLowerCase()}
                        {row.actor ? ` · by ${row.actor.fullName}` : ''}
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'type',
                  header: 'Direction',
                  render: (row) => (
                    <span className={cn('font-label-xs text-label-xs', row.amount > 0 ? 'text-secondary' : 'text-error')}>
                      {row.amount > 0 ? 'into pool' : 'out of pool'}
                    </span>
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
                  header: 'Pool after',
                  align: 'right',
                  render: (row) => <span className="font-mono text-label-sm tabular text-on-surface-variant">{row.balanceAfter}</span>,
                },
                {
                  key: 'created',
                  header: 'When',
                  align: 'right',
                  render: (row) => (
                    <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDateTime(row.createdAt)}</span>
                  ),
                },
              ]}
            />
            <Pagination
              page={pool.data.transactions.pagination.page}
              totalPages={pool.data.transactions.pagination.totalPages}
              total={pool.data.transactions.pagination.total}
              onPageChange={setPage}
              className="border-t border-outline-variant"
            />
          </Card>

          <Card>
            <CardHeader title="Pool policy" />
            <Divider />
            <div className="p-space-lg">
              <MetricRow label="Last updated" value={formatDateTime(pool.data.pool.updatedAt)} />
              <MetricRow label="Funding source" value="Forfeited stakes" />
              <MetricRow label="Payout source" value="Platform rewards & adjustments" />
              <p className="mt-space-sm font-label-xs text-label-xs text-on-surface-variant">
                All values are virtual platform points. No real money is involved at any point.
              </p>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Adjust the reward pool"
        description="Positive credits the pool, negative debits it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustOpen(false)} disabled={adjusting}>
              Cancel
            </Button>
            <Button loading={adjusting} disabled={!reason.trim() || amount === 0} onClick={() => void submitAdjustment()}>
              Apply adjustment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-md">
          <Input
            label="Amount (negative to debit)"
            type="number"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
          <Input
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Top-up funded by the platform growth budget"
            hint="Recorded on the pool ledger entry."
          />
        </div>
      </Modal>
    </div>
  );
}
