import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { walletApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock, Pagination, SectionHeader, StatCard } from '../../components/ui/data';
import { Select } from '../../components/ui/forms';
import { TransactionList, WalletBalanceCard } from '../../components/domain/AccountabilityPanels';
import { BarList } from '../../components/domain/Charts';
import { TRANSACTION_LABELS } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';

const TYPE_OPTIONS = [
  { value: 'ALL', label: 'All transaction types' },
  ...Object.entries(TRANSACTION_LABELS).map(([value, label]) => ({ value, label })),
];

/** Points wallet with the full ledger. Every figure is a backend projection. */
export function WalletPage() {
  useDocumentTitle('Wallet');
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('ALL');

  const wallet = useAsync(() => walletApi.get(), []);
  const insights = useAsync(() => walletApi.insights(), []);
  const transactions = useAsync(
    () => walletApi.transactions({ page, pageSize: 20, type: type === 'ALL' ? undefined : type }),
    [page, type],
  );

  // Aggregate the visible page into a breakdown so the ledger is easy to scan.
  const breakdown = useMemo(() => {
    const items = transactions.data?.items ?? [];
    const totals = new Map<string, number>();
    for (const entry of items) {
      if (entry.amount <= 0) continue;
      totals.set(entry.type, (totals.get(entry.type) ?? 0) + entry.amount);
    }
    return [...totals.entries()]
      .map(([key, value]) => ({ label: TRANSACTION_LABELS[key] ?? key, value }))
      .sort((a, b) => b.value - a.value);
  }, [transactions.data]);

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Accountability wallet"
        title="Wallet"
        meta={
          <span className="flex items-baseline gap-1.5">
            <span className="micro-label text-on-surface-variant">Lifetime earned:</span>
            <span className="font-mono text-label-md tabular text-secondary">
              {user?.wallet.lifetimeEarned.toLocaleString('en-US')} pts
            </span>
          </span>
        }
      />

      {wallet.error ? (
        <ErrorBlock title="Could not load your wallet" message={wallet.error} onRetry={() => void wallet.refetch()} />
      ) : wallet.loading || !wallet.data ? (
        <LoadingBlock label="Loading wallet…" rows={3} />
      ) : (
        <>
          <WalletBalanceCard
            availableBalance={wallet.data.availableBalance}
            lockedBalance={wallet.data.lockedBalance}
            lifetimeEarned={wallet.data.lifetimeEarned}
            lifetimeForfeited={wallet.data.lifetimeForfeited}
            activeCommitments={wallet.data.stakes.activeCommitments}
          />

          <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
            <StatCard
              label="Locked in stakes"
              value={wallet.data.stakes.activeStakePoints}
              icon="lock"
              tone="primary"
              hint="Held in escrow for active attempts"
            />
            <StatCard
              label="Returned"
              value={wallet.data.stakes.returnedPoints}
              icon="undo"
              tone="success"
              hint={`${wallet.data.stakes.returnedCount} settlement(s)`}
            />
            <StatCard
              label="Forfeited"
              value={wallet.data.stakes.forfeitedPoints}
              icon="gavel"
              tone={wallet.data.stakes.forfeitedPoints > 0 ? 'risk' : 'neutral'}
              hint={`${wallet.data.stakes.forfeitedCount} failed attempt(s)`}
            />
            <StatCard
              label="Total balance"
              value={wallet.data.totalBalance}
              icon="account_balance"
              hint="Available + locked"
            />
          </div>

          <Alert tone="info" icon="info">
            Stake It uses <strong>virtual platform points only</strong>. There is no real money, no wagering and no financial
            transaction anywhere in this system. Every balance change is recorded in the ledger below.
          </Alert>
        </>
      )}

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Transaction ledger"
              subtitle="Every point movement, newest first"
              action={
                <Select
                  value={type}
                  onChange={(event) => {
                    setType(event.target.value);
                    setPage(1);
                  }}
                  options={TYPE_OPTIONS}
                  className="w-56"
                />
              }
            />
            <Divider />
            {transactions.error ? (
              <ErrorBlock message={transactions.error} onRetry={() => void transactions.refetch()} />
            ) : transactions.loading ? (
              <LoadingBlock label="Loading ledger…" rows={4} />
            ) : (
              <TransactionList transactions={transactions.data?.items ?? []} />
            )}
            {transactions.data ? (
              <Pagination
                page={transactions.data.pagination.page}
                totalPages={transactions.data.pagination.totalPages}
                total={transactions.data.pagination.total}
                onPageChange={setPage}
                className="border-t border-outline-variant"
              />
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-space-lg">
          <Card>
            <CardHeader title="Credits on this page" subtitle="Grouped by transaction type" />
            <Divider />
            <div className="px-space-lg py-space-md">
              {breakdown.length === 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No credits in the current page of the ledger.
                </p>
              ) : (
                <BarList data={breakdown} unit=" pts" />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Your track record" subtitle={insights.data?.headline ?? 'Based on settled attempts'} />
            <Divider />
            {insights.loading ? (
              <LoadingBlock label="Loading insights…" rows={2} />
            ) : insights.data ? (
              <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Settled attempts</span>
                  <span className="font-mono tabular text-on-surface">{insights.data.totalAttempts}</span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Completions</span>
                  <span className="font-mono tabular text-secondary">{insights.data.completions}</span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Failures</span>
                  <span className="font-mono tabular text-error">{insights.data.failures}</span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Completion rate</span>
                  <span className="font-mono tabular text-on-surface">
                    {Math.round(insights.data.completionRate * 100)}%
                  </span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Average score</span>
                  <span className="font-mono tabular text-on-surface">{insights.data.averageScore.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">On-time completions</span>
                  <span className="font-mono tabular text-on-surface">
                    {Math.round(insights.data.onTimeRate * 100)}%
                  </span>
                </div>
                <Chip tone="info" icon="insights" className="mt-space-xs w-fit">
                  {insights.data.suggestedStance.toLowerCase()} commitment suggested
                </Chip>
              </div>
            ) : (
              <p className="px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
                Complete or attempt a course to build a track record.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Related views" />
            <Divider />
            <div className="flex flex-col divide-y divide-outline-variant">
              {[
                { to: '/stakes', icon: 'lock', label: 'Stakes', hint: 'Active, returned and forfeited stakes' },
                { to: '/rewards', icon: 'savings', label: 'Rewards', hint: 'Earned bonuses and rewards' },
                { to: '/my-courses', icon: 'school', label: 'My courses', hint: 'Track progress and deadlines' },
              ].map((item) => (
                <Link key={item.to} to={item.to} className="flex items-center justify-between gap-space-md px-space-lg py-space-sm hover:bg-surface-container-low">
                  <span className="flex items-center gap-space-sm">
                    <MaterialIcon name={item.icon} className="text-on-surface-variant" />
                    <span className="flex flex-col">
                      <span className="font-label-sm text-label-sm text-on-surface">{item.label}</span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">{item.hint}</span>
                    </span>
                  </span>
                  <MaterialIcon name="chevron_right" className="text-on-surface-variant" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
