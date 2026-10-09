import { useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsApi, adminApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Card, CardHeader, DataTable, ErrorBlock, LoadingBlock, MetricRow, SectionHeader, StatCard } from '../../components/ui/data';
import { BarList } from '../../components/domain/Charts';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatPoints, formatRelative, TRANSACTION_LABELS } from '../../utils/format';
import { cn } from '../../utils/cn';

/** Platform overview for administrators. */
export function AdminDashboardPage() {
  useDocumentTitle('Admin dashboard');
  const toast = useToast();

  const dashboard = useAsync(() => analyticsApi.adminDashboard(), []);
  const [engineRunning, setEngineRunning] = useState(false);

  if (dashboard.loading) return <LoadingBlock label="Loading platform state…" rows={5} />;
  if (dashboard.error || !dashboard.data) {
    return <ErrorBlock title="Could not load the admin dashboard" message={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }

  const data = dashboard.data;

  const runEngine = async () => {
    setEngineRunning(true);
    try {
      await adminApi.runDeadlineEngine();
      toast.success('Deadline engine finished', 'Expired attempts were settled and reminders dispatched.');
      await dashboard.refetch();
    } catch (caught) {
      toast.error('Deadline engine failed', errorMessage(caught));
    } finally {
      setEngineRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Admin dashboard"
        meta={
          <Button variant="secondary" icon="play_circle" loading={engineRunning} onClick={() => void runEngine()}>
            Run deadline engine
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard label="Users" value={data.users.total} icon="group" hint={`${data.users.learners} learners · ${data.users.instructors} instructors`} />
        <StatCard
          label="Courses"
          value={data.courses.total}
          icon="library_books"
          hint={`${data.courses.published} published · ${data.courses.draft} draft`}
        />
        <StatCard
          label="Points in circulation"
          value={formatPoints(data.economy.wallet.totalAvailable, { suffix: false })}
          icon="account_balance_wallet"
          hint={`${data.economy.wallet.totalLocked} locked in stakes`}
        />
        <StatCard
          label="Reward pool"
          value={formatPoints(data.economy.rewardPool.balance, { suffix: false })}
          icon="savings"
          tone="success"
          hint={`in ${data.economy.rewardPool.totalIn} · out ${data.economy.rewardPool.totalOut}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Attempt outcomes" subtitle="Settled and in-flight learner attempts across the platform" />
          <Divider />
          <div className="p-space-lg">
            <BarList
              data={Object.entries(data.attempts).map(([status, entry]) => ({
                label: status.replace(/_/g, ' ').toLowerCase(),
                value: entry.count,
                tone: status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'risk' : 'primary',
              }))}
              emptyLabel="No attempts recorded"
            />
          </div>
          <Divider />
          <div className="grid grid-cols-2 gap-space-md p-space-lg">
            <MetricRow label="Points awarded" value={`${data.economy.pointsAwarded} pts`} tone="positive" />
            <MetricRow label="Points forfeited" value={`${data.economy.pointsForfeited} pts`} tone="negative" />
            <MetricRow label="Wallet accounts" value={String(data.economy.wallet.totalAccounts)} />
            <MetricRow label="Average balance" value={`${data.economy.wallet.averageBalance} pts`} />
          </div>
        </Card>

        <div className="flex flex-col gap-space-lg">
          <Card>
            <CardHeader title="Enrolment states" />
            <Divider />
            <div className="p-space-lg">
              <BarList
                data={Object.entries(data.enrollments).map(([status, count]) => ({
                  label: status.toLowerCase(),
                  value: count,
                  tone: status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'risk' : 'primary',
                }))}
                emptyLabel="No enrolments yet"
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Instructor badges" subtitle="Active reputation tiers" />
            <Divider />
            <div className="p-space-lg">
              <MetricRow label="Gold" value={String(data.badges.gold)} tone="positive" />
              <MetricRow label="Silver" value={String(data.badges.silver)} />
              <MetricRow label="Bronze" value={String(data.badges.bronze)} />
              <Link to="/admin/badges" className="mt-space-sm block font-label-sm text-label-sm text-primary hover:underline">
                Manage badges
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Moderation" />
            <Divider />
            <div className="flex items-center justify-between p-space-lg">
              <span className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface">
                <MaterialIcon name={data.moderation.flaggedReviews > 0 ? 'flag' : 'verified'} className={cn(data.moderation.flaggedReviews > 0 ? 'text-error' : 'text-secondary')} />
                Flagged reviews
              </span>
              <span className="flex items-center gap-space-sm">
                <Chip tone={data.moderation.flaggedReviews > 0 ? 'risk' : 'earned'}>{data.moderation.flaggedReviews}</Chip>
                <Link to="/admin/analytics" className="font-label-sm text-label-sm text-primary hover:underline">
                  Review
                </Link>
              </span>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent point movements"
            subtitle="Across every wallet"
            action={
              <Link to="/admin/analytics" className="font-label-sm text-label-sm text-primary hover:underline">
                Full ledger
              </Link>
            }
          />
          <DataTable
            rows={data.recentTransactions}
            keyFor={(row) => row.id}
            columns={[
              {
                key: 'user',
                header: 'Account',
                render: (row) => (
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-on-surface">{row.user.fullName}</span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">{row.user.role}</span>
                  </div>
                ),
              },
              {
                key: 'type',
                header: 'Type',
                render: (row) => (
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {TRANSACTION_LABELS[row.type] ?? row.type}
                  </span>
                ),
              },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                render: (row) => (
                  <span className={cn('font-mono text-label-sm tabular', row.amount > 0 ? 'text-secondary' : 'text-error')}>
                    {row.amount > 0 ? '+' : '−'}
                    {Math.abs(row.amount)}
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Reward pool movements" subtitle="Forfeited stakes in, rewards out" />
          <DataTable
            rows={data.recentPoolTransactions}
            keyFor={(row) => row.id}
            columns={[
              {
                key: 'description',
                header: 'Description',
                render: (row) => (
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-on-surface">{row.description}</span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">{formatRelative(row.createdAt)}</span>
                  </div>
                ),
              },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                render: (row) => (
                  <span className={cn('font-mono text-label-sm tabular', row.amount > 0 ? 'text-secondary' : 'text-error')}>
                    {row.amount > 0 ? '+' : '−'}
                    {Math.abs(row.amount)}
                  </span>
                ),
              },
              {
                key: 'balance',
                header: 'Pool',
                align: 'right',
                render: (row) => <span className="font-mono text-label-xs tabular text-on-surface-variant">{row.balanceAfter}</span>,
              },
            ]}
          />
        </Card>
      </div>

      <p className="font-label-xs text-label-xs text-on-surface-variant">
        The deadline engine also runs automatically on a schedule inside the API process — this button simply triggers a run
        immediately for demos and support.
      </p>
    </div>
  );
}

