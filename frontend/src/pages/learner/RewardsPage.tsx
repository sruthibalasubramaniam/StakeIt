import { rewardApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock, MetricRow, SectionHeader, StatCard } from '../../components/ui/data';
import { BarList } from '../../components/domain/Charts';
import { TransactionList } from '../../components/domain/AccountabilityPanels';
import { formatPoints } from '../../utils/format';

/** Rewards: what has been earned, what is still at play, and the platform pool. */
export function RewardsPage() {
  useDocumentTitle('Rewards');

  const rewards = useAsync(() => rewardApi.list(), []);
  const pool = useAsync(() => rewardApi.pool(), []);

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Incentive protocol"
        title="Rewards"
        meta={
          <span className="flex items-baseline gap-1.5">
            <span className="micro-label text-on-surface-variant">Lifetime earned:</span>
            <span className="font-mono text-label-md tabular text-secondary">
              {formatPoints(rewards.data?.totals.lifetimeEarned ?? 0, { suffix: false })} pts
            </span>
          </span>
        }
      />

      {rewards.error ? (
        <ErrorBlock title="Could not load rewards" message={rewards.error} onRetry={() => void rewards.refetch()} />
      ) : rewards.loading || !rewards.data ? (
        <LoadingBlock label="Loading rewards…" rows={3} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
            <StatCard
              label="Course rewards"
              value={rewards.data.totals.courseRewards}
              icon="school"
              tone="success"
              hint="Awarded on verified completion"
            />
            <StatCard
              label="Commitment bonuses"
              value={rewards.data.totals.commitmentBonuses}
              icon="timer"
              tone="success"
              hint="Accelerated deadlines met"
            />
            <StatCard
              label="Performance bonuses"
              value={rewards.data.totals.performanceBonuses}
              icon="bolt"
              tone="success"
              hint="Final score above threshold"
            />
            <StatCard
              label="Retry recovery"
              value={rewards.data.totals.retryRewards}
              icon="restart_alt"
              hint="Original stake ÷ attempt number"
            />
          </div>

          <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader title="Reward history" subtitle="Every reward and bonus credited to your wallet" />
                <Divider />
                <TransactionList
                  transactions={rewards.data.history}
                  emptyLabel="No rewards earned yet — complete a course to unlock your first payout."
                />
              </Card>
            </div>

            <div className="flex flex-col gap-space-lg">
              <Card>
                <CardHeader title="Earned by type" />
                <Divider />
                <div className="px-space-lg py-space-md">
                  <BarList
                    data={
                      [
                        { label: 'Course rewards', value: rewards.data.totals.courseRewards, tone: 'success' as const },
                        { label: 'Commitment bonuses', value: rewards.data.totals.commitmentBonuses, tone: 'success' as const },
                        { label: 'Performance bonuses', value: rewards.data.totals.performanceBonuses, tone: 'success' as const },
                        { label: 'Retry recovery', value: rewards.data.totals.retryRewards, tone: 'primary' as const },
                        { label: 'Welcome grant', value: rewards.data.totals.welcomeGrant, tone: 'muted' as const },
                      ].filter((entry) => entry.value > 0)
                    }
                    unit=" pts"
                    emptyLabel="No rewards earned yet"
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Platform reward pool"
                  subtitle="Funded by forfeited stakes"
                  action={<MaterialIcon name="account_balance" className="text-on-surface-variant" />}
                />
                <Divider />
                <div className="px-space-lg py-space-md">
                  {pool.error ? (
                    <ErrorBlock message={pool.error} onRetry={() => void pool.refetch()} />
                  ) : pool.loading || !pool.data ? (
                    <LoadingBlock label="Loading pool…" rows={2} />
                  ) : (
                    <>
                      <MetricRow label="Current pool balance" value={`${pool.data.pool.balance} pts`} strong />
                      <MetricRow label="Total forfeited in" value={`${pool.data.pool.totalIn} pts`} />
                      <MetricRow label="Total paid out" value={`${pool.data.pool.totalOut} pts`} />
                      <p className="mt-space-sm font-label-xs text-label-xs text-on-surface-variant">
                        Forfeited stakes always land here. The pool is never paid directly to another learner.
                      </p>
                    </>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Still at play" />
                <Divider />
                <div className="px-space-lg py-space-md">
                  <MetricRow label="Locked in active stakes" value={`${rewards.data.stakes.activeStakePoints} pts`} tone="positive" />
                  <MetricRow label="Accelerated commitments" value={String(rewards.data.stakes.activeCommitments)} />
                  <MetricRow label="Forfeited to date" value={`${rewards.data.stakes.forfeitedPoints} pts`} tone="negative" />
                </div>
              </Card>

              <Alert tone="info" icon="info">
                {rewards.data.insights.headline}
              </Alert>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-space-sm">
            <Chip tone="earned" icon="verified">
              virtual points only
            </Chip>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              No real money, no wagering, no financial transactions.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
