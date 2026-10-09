import { useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Chip, Divider, MaterialIcon, ProgressBar } from '../../components/ui/core';
import { Card, CardHeader, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatCard, Tabs } from '../../components/ui/data';
import { WalletBalanceCard } from '../../components/domain/AccountabilityPanels';
import { AchievementsGrid } from '../../components/domain/AccountabilityPanels';
import { EnrolledCourseRow } from '../../components/domain/CourseCard';
import { TransactionList } from '../../components/domain/AccountabilityPanels';
import { NotificationRowItem } from '../../components/domain/NotificationsPanel';
import { formatDate, formatPercent, formatPoints, statusLabel } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../utils/cn';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth();

  const dashboard = useAsync(() => analyticsApi.learnerDashboard(), []);
  const [tab, setTab] = useState<'active' | 'completed'>('active');

  if (dashboard.loading) {
    return (
      <div className="flex flex-col gap-space-lg">
        <SectionHeader title="Enrolled Courses" />
        <LoadingBlock label="Loading your dashboard…" rows={4} />
      </div>
    );
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <div className="flex flex-col gap-space-lg">
        <SectionHeader title="Enrolled Courses" />
        <ErrorBlock
          title="Could not load your dashboard"
          message={dashboard.error}
          onRetry={() => void dashboard.refetch()}
        />
      </div>
    );
  }

  const data = dashboard.data;
  const { summary, wallet, activeCourses, completedCourses, atRisk, upcomingDeadlines } = data;
  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return (
    <div className="flex flex-col gap-space-xl">
      <SectionHeader
        title="Enrolled Courses"
        meta={
          <div className="flex items-center gap-space-lg">
            <span className="flex items-baseline gap-1.5">
              <span className="micro-label text-on-surface-variant">Total staked:</span>
              <span className="font-mono text-label-md tabular text-on-surface">
                {formatPoints(summary.totalStaked, { suffix: false })} pts
              </span>
            </span>
            <span className="hidden h-4 w-px bg-outline-variant sm:block" />
            <span className="flex items-baseline gap-1.5">
              <span className="micro-label text-on-surface-variant">Active tracks:</span>
              <span className="font-mono text-label-md tabular text-on-surface">{summary.activeCourses}</span>
            </span>
          </div>
        }
      />

      <p className="-mt-space-lg font-body-md text-body-md text-on-surface-variant">
        Welcome back, {firstName}. {summary.activeCourses > 0
          ? `You have ${summary.activeCourses} active track${summary.activeCourses === 1 ? '' : 's'} holding ${formatPoints(summary.totalStaked)} in escrow.`
          : 'You have no active stakes yet — browse the catalogue to begin.'}
      </p>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        <StatCard label="Available points" value={wallet.availableBalance.toLocaleString('en-US')} icon="account_balance_wallet" hint="Spendable balance" />
        <StatCard
          label="Locked in stakes"
          value={wallet.lockedBalance.toLocaleString('en-US')}
          icon="lock"
          tone="primary"
          hint={`${summary.activeCourses} active attempt(s)`}
        />
        <StatCard
          label="At risk"
          value={summary.atRiskCourses}
          icon="warning"
          tone={summary.atRiskCourses > 0 ? 'risk' : 'neutral'}
          hint={summary.atRiskCourses > 0 ? 'Behind expected progress' : 'All tracks on schedule'}
        />
        <StatCard
          label="Completed"
          value={summary.completedCourses}
          icon="workspace_premium"
          tone="success"
          hint={summary.bestScore > 0 ? `Best score ${formatPercent(summary.bestScore, 1)}` : 'No completions yet'}
        />
      </div>

      {/* At-risk alerts take priority over everything else on the page. */}
      {atRisk.length > 0 ? (
        <section className="flex flex-col gap-space-md">
          <div className="flex items-center gap-space-sm">
            <MaterialIcon name="warning" className="text-error" />
            <h2 className="font-headline-sm text-headline-sm text-on-surface">Tracks at risk</h2>
            <Chip tone="risk">{atRisk.length}</Chip>
          </div>
          {atRisk.map((course) => (
            <div key={course.attemptId} className="surface-card flex flex-col gap-space-md border-error/30 bg-error-container/10 p-space-lg">
              <div className="flex flex-wrap items-start justify-between gap-space-md">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-label-xs text-on-surface-variant">{course.code}</span>
                  <span className="font-headline-sm text-headline-sm text-on-surface">{course.title}</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    You are <span className="font-mono text-error">{formatPercent(course.gap)}</span> behind expected progress with{' '}
                    <span className="font-mono text-error">{course.daysRemaining} day(s)</span> left. {formatPoints(course.lockedStake)} at risk.
                  </span>
                </div>
                <Link
                  to={`/learn/${course.enrollmentId}`}
                  className="inline-flex items-center gap-1 rounded bg-primary-container px-space-md py-1.5 font-label-sm text-label-sm text-on-primary hover:bg-primary"
                >
                  Resume
                  <MaterialIcon name="arrow_forward" className="text-[16px]" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-space-md">
                <div className="flex flex-col gap-1">
                  <span className="micro-label text-on-surface-variant">Actual {formatPercent(course.progressPercent)}</span>
                  <ProgressBar value={course.progressPercent} tone="risk" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="micro-label text-on-surface-variant">Expected {formatPercent(course.expectedProgressPercent)}</span>
                  <ProgressBar value={course.expectedProgressPercent} tone="muted" />
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* Enrolled courses */}
      <section className="flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-outline-variant pb-space-sm">
          <Tabs
            tabs={[
              { id: 'active', label: 'Active', count: activeCourses.length },
              { id: 'completed', label: 'Completed', count: completedCourses.length },
            ]}
            active={tab}
            onChange={(id) => setTab(id as 'active' | 'completed')}
          />
          <span className="micro-label text-on-surface-variant">
            Auto-forfeit deadline · 23:59 UTC
          </span>
        </div>

        {tab === 'active' ? (
          activeCourses.length === 0 ? (
            <div className="surface-card">
              <EmptyState
                icon="school"
                title="No active courses"
                description="Stake points on a course to start an accountability track. Your stake is returned when you complete it."
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
            </div>
          ) : (
            <div className="surface-card divide-y divide-outline-variant overflow-hidden">
              {activeCourses.map((course) => (
                <EnrolledCourseRow
                  key={course.attemptId}
                  code={course.course.code}
                  title={course.course.title}
                  statusLabel={course.pacing.isAtRisk ? course.pacing.riskLabel.toUpperCase() : course.pacing.riskLabel}
                  statusTone={course.pacing.isAtRisk ? 'risk' : course.pacing.riskLevel === 'STEADY' ? 'stake' : 'earned'}
                  subtitle={`Attempt ${course.attemptNumber} · ${statusLabel(course.status)}`}
                  progressPercent={course.progressPercent}
                  atRisk={course.pacing.isAtRisk}
                  daysRemaining={course.pacing.daysRemaining}
                  deadline={course.normalDeadline}
                  stakeAmount={course.lockedStake}
                  resumeHref={`/learn/${course.enrollmentId}`}
                />
              ))}
            </div>
          )
        ) : completedCourses.length === 0 ? (
          <div className="surface-card">
            <EmptyState
              icon="workspace_premium"
              title="No completed courses yet"
              description="Once you finish a course and the final test passes, your stake is returned and the completion receipt appears here."
            />
          </div>
        ) : (
          <div className="surface-card divide-y divide-outline-variant overflow-hidden">
            {completedCourses.map((course) => (
              <Link
                key={course.enrollmentId}
                to={course.attemptId ? `/learn/${course.enrollmentId}/completion` : '/my-courses'}
                className="flex items-center justify-between gap-space-md p-space-lg transition-colors hover:bg-surface-container-low"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-label-xs text-on-surface-variant">{course.course.code}</span>
                  <span className="font-headline-sm text-headline-sm text-on-surface">{course.course.title}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    Completed {formatDate(course.completedAt)}
                    {course.hasReview ? ' · reviewed' : ' · not yet reviewed'}
                  </span>
                </div>
                <div className="flex items-center gap-space-lg">
                  <div className="flex flex-col items-end">
                    <span className="font-mono text-label-md tabular text-secondary">
                      {course.finalScore !== null ? formatPercent(course.finalScore, 1) : '—'}
                    </span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">
                      +{course.pointsAwarded.toLocaleString('en-US')} pts
                    </span>
                  </div>
                  <MaterialIcon name="arrow_forward" className="text-on-surface-variant" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Wallet + deadlines */}
      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WalletBalanceCard
            availableBalance={wallet.availableBalance}
            lockedBalance={wallet.lockedBalance}
            lifetimeEarned={wallet.lifetimeEarned}
            lifetimeForfeited={wallet.lifetimeForfeited}
          />
        </div>

        <Card>
          <CardHeader
            title="Upcoming deadlines"
            subtitle={`${upcomingDeadlines.length} track(s)`}
            action={
              <Link to="/my-courses" className="font-label-sm text-label-sm text-primary hover:underline">
                All
              </Link>
            }
          />
          <Divider />
          {upcomingDeadlines.length === 0 ? (
            <EmptyState icon="event_available" title="Nothing due" description="No active deadlines." />
          ) : (
            <ul className="divide-y divide-outline-variant">
              {upcomingDeadlines.map((deadline) => (
                <li key={deadline.attemptId} className="flex items-center justify-between gap-space-sm px-space-lg py-space-sm">
                  <div className="flex min-w-0 flex-col">
                    <Link to={`/learn/${deadline.enrollmentId}`} className="truncate font-label-sm text-label-sm text-on-surface hover:text-primary">
                      {deadline.title}
                    </Link>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">
                      {deadline.acceleratedDaysRemaining !== null
                        ? `Accelerated: ${deadline.acceleratedDaysRemaining} day(s)`
                        : `${deadline.lockedStake} pts staked`}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-label-sm tabular',
                      deadline.riskLevel === 'AT_RISK' || deadline.riskLevel === 'GRACE_PERIOD' ? 'text-error' : 'text-on-surface',
                    )}
                  >
                    {deadline.normalDeadline}d
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Rewards + ledger */}
      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent rewards"
            subtitle="Course rewards, bonuses and recovery payouts"
            action={
              <Link to="/rewards" className="font-label-sm text-label-sm text-primary hover:underline">
                All rewards
              </Link>
            }
          />
          <Divider />
          <TransactionList transactions={data.recentRewards} emptyLabel="No rewards earned yet." />
        </Card>

        <Card>
          <CardHeader
            title="Recent transactions"
            subtitle="Every point movement is recorded in the ledger"
            action={
              <Link to="/wallet" className="font-label-sm text-label-sm text-primary hover:underline">
                Full ledger
              </Link>
            }
          />
          <Divider />
          <TransactionList transactions={data.recentTransactions} />
        </Card>
      </div>

      {/* Achievements */}
      <section className="flex flex-col gap-space-md">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Achievements</h2>
        <AchievementsGrid achievements={data.achievements} />
      </section>

      {/* Notifications preview */}
      <Card>
        <CardHeader
          title="Recent activity"
          action={
            <Link to="/notifications" className="font-label-sm text-label-sm text-primary hover:underline">
              All notifications
            </Link>
          }
        />
        <Divider />
        {data.notifications.length === 0 ? (
          <EmptyState icon="notifications_none" title="No activity yet" />
        ) : (
          <ul className="divide-y divide-outline-variant">
            {data.notifications.slice(0, 4).map((notification) => (
              <NotificationRowItem key={notification.id} notification={notification} />
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-1.5 pb-space-md font-label-xs text-label-xs text-on-surface-variant">
        <MaterialIcon name="gavel" className="text-[13px]" />
        Completion thresholds require 100% verified submission before timer expiration. All values are virtual platform points.
      </p>
    </div>
  );
}
