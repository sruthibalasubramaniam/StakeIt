import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Chip, MaterialIcon, ProgressBar } from '../ui/core';
import { formatCountdown, formatPercent, formatPoints, statusLabel } from '../../utils/format';
import type { CourseSummary } from '../../types/api';

export function DifficultyChip({ difficulty }: { difficulty: string }) {
  const tone = difficulty === 'BEGINNER' ? 'earned' : difficulty === 'INTERMEDIATE' ? 'info' : difficulty === 'ADVANCED' ? 'stake' : 'risk';
  return <Chip tone={tone}>{difficulty.toLowerCase()}</Chip>;
}

export function ReputationBadge({ tier, showLabel = true }: { tier: string; showLabel?: boolean }) {
  if (!tier || tier === 'NONE') {
    return showLabel ? <Chip tone="locked">unrated</Chip> : null;
  }
  const tone = tier === 'GOLD' ? 'earned' : tier === 'SILVER' ? 'info' : 'neutral';
  const icon = tier === 'GOLD' ? 'military_tech' : tier === 'SILVER' ? 'workspace_premium' : 'verified';
  return (
    <Chip tone={tone} icon={icon}>
      {tier.toLowerCase()}
    </Chip>
  );
}

/**
 * Catalogue card. Uses the design's hairline card with an internal divider
 * grid rather than shadows.
 */
export function CourseCard({ course, className }: { course: CourseSummary; className?: string }) {
  const enrolment = course.enrollment;
  const canEnrol = !enrolment || ['FAILED', 'WITHDRAWN'].includes(enrolment.status);

  return (
    <article className={cn('surface-card flex flex-col transition-colors hover:border-outline', className)}>
      <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
        <div className="flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-sm">
            <span className="font-mono text-label-xs text-on-surface-variant">{course.code}</span>
            <span className="text-outline-variant">•</span>
            <span className="micro-label text-on-surface-variant">{course.category}</span>
          </div>
          <div className="flex items-center gap-space-xs">
            <DifficultyChip difficulty={course.difficulty} />
            <ReputationBadge tier={course.instructor.badge} showLabel={false} />
          </div>
        </div>

        <Link to={`/courses/${course.slug}`} className="font-headline-sm text-headline-sm text-on-surface transition-colors hover:text-primary">
          {course.title}
        </Link>

        <p className="line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">{course.shortDescription}</p>

        <div className="flex flex-wrap items-center gap-space-md pt-space-xs font-label-xs text-label-xs text-on-surface-variant">
          <span className="flex items-center gap-1">
            <MaterialIcon name="person" className="text-[13px]" />
            {course.instructor.fullName}
          </span>
          <span className="flex items-center gap-1">
            <MaterialIcon name="schedule" className="text-[13px]" />
            {course.durationDays} days
          </span>
          {course.moduleCount !== undefined ? (
            <span className="flex items-center gap-1">
              <MaterialIcon name="layers" className="text-[13px]" />
              {course.moduleCount} modules
            </span>
          ) : null}
          {course.averageRating ? (
            <span className="flex items-center gap-1">
              <MaterialIcon name="star" filled className="text-[13px] text-primary-container" />
              <span className="metric text-on-surface">{course.averageRating.toFixed(1)}</span>
              <span>({course.ratingCount})</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="h-px w-full bg-surface-container" />

      <div className="grid grid-cols-3 gap-space-md px-space-lg py-space-md">
        <div className="flex flex-col gap-0.5">
          <span className="micro-label text-on-surface-variant">Stake</span>
          <span className="font-mono text-label-md tabular text-on-surface">{formatPoints(course.baseStake, { suffix: false })}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="micro-label text-on-surface-variant">Reward</span>
          <span className="font-mono text-label-md tabular text-secondary">
            +{formatPoints(course.completionReward, { suffix: false })}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="micro-label text-on-surface-variant">Bonus cap</span>
          <span className="font-mono text-label-md tabular text-on-surface-variant">
            +{formatPoints(course.commitmentBonus + course.performanceBonus, { suffix: false })}
          </span>
        </div>
      </div>

      <div className="h-px w-full bg-surface-container" />

      <div className="flex items-center justify-between px-space-lg py-space-md">
        <span className="font-label-xs text-label-xs text-on-surface-variant">
          {course.learnerCount !== undefined ? `${course.learnerCount} learners` : statusLabel(course.status)}
        </span>
        {enrolment && enrolment.status === 'ACTIVE' ? (
          <Link
            to={`/learn/${enrolment.id}`}
            className="inline-flex items-center gap-1 font-label-sm text-label-sm font-medium text-primary transition-transform hover:translate-x-0.5"
          >
            Continue
            <MaterialIcon name="arrow_forward" className="text-[16px]" />
          </Link>
        ) : enrolment && enrolment.status === 'COMPLETED' ? (
          <Chip tone="earned" icon="check">completed</Chip>
        ) : (
          <Link
            to={`/courses/${course.slug}/enroll`}
            className="inline-flex items-center gap-1 font-label-sm text-label-sm font-medium text-primary transition-transform hover:translate-x-0.5"
          >
            {canEnrol && enrolment ? 'Retry' : 'View & stake'}
            <MaterialIcon name="arrow_forward" className="text-[16px]" />
          </Link>
        )}
      </div>
    </article>
  );
}

/**
 * Compact dashboard row — the enrolled-course list from the supplied design
 * (code · status, title, current module, progress, days left, stake, resume).
 */
export function EnrolledCourseRow({
  code,
  title,
  statusLabel: label,
  statusTone,
  subtitle,
  progressPercent,
  atRisk = false,
  daysRemaining,
  deadline,
  stakeAmount,
  resumeHref,
}: {
  code: string;
  title: string;
  statusLabel: string;
  statusTone: 'neutral' | 'earned' | 'risk' | 'stake';
  subtitle: string;
  progressPercent: number;
  atRisk?: boolean;
  daysRemaining: number;
  deadline: string;
  stakeAmount: number;
  resumeHref: string;
}) {
  return (
    <div
      className={cn(
        'group flex flex-col justify-between p-space-lg transition-colors duration-150 lg:flex-row lg:items-center',
        atRisk ? 'bg-error-container/10 hover:bg-error-container/20' : 'hover:bg-surface-container-low',
      )}
    >
      <div className="flex flex-col lg:w-5/12 lg:pr-space-lg">
        <div className="mb-1 flex items-center gap-space-xs">
          <span className="font-mono text-label-xs text-on-surface-variant">{code}</span>
          <span className="text-label-xs text-outline-variant">•</span>
          <span
            className={cn(
              'font-label-xs text-label-xs font-medium',
              statusTone === 'risk' ? 'font-semibold uppercase tracking-wide text-error' : statusTone === 'earned' ? 'text-secondary' : 'text-on-surface-variant',
            )}
          >
            {label}
          </span>
        </div>
        <Link
          to={resumeHref}
          className={cn(
            'font-headline-sm text-headline-sm text-on-surface transition-colors',
            atRisk ? 'group-hover:text-error' : 'group-hover:text-primary',
          )}
        >
          {title}
        </Link>
        <span className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{subtitle}</span>
      </div>

      <div className="mt-space-md flex flex-col gap-space-lg sm:flex-row sm:items-center lg:mt-0 lg:w-7/12 lg:justify-end">
        <div className="flex w-full flex-col sm:w-48">
          <div className="mb-1.5 flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
            <span className={atRisk ? 'font-medium text-error' : ''}>{atRisk ? 'Pacing Behind' : 'Progress'}</span>
            <span className={cn('metric font-medium', atRisk ? 'text-error' : 'text-on-surface')}>{formatPercent(progressPercent)}</span>
          </div>
          <ProgressBar value={progressPercent} tone={atRisk ? 'risk' : progressPercent >= 100 ? 'success' : 'primary'} />
        </div>

        <div className="flex min-w-[210px] items-center justify-between gap-space-xl sm:justify-end">
          <div className="flex flex-col text-left font-label-sm text-label-sm sm:text-right">
            <span className={cn(atRisk ? 'font-semibold text-error' : 'font-medium text-on-surface')}>
              {formatCountdown(deadline)}
            </span>
            <span className={cn('font-label-xs text-label-xs', atRisk ? 'text-error' : 'text-on-surface-variant')}>
              {atRisk ? 'Risk' : 'Stake'}: {formatPoints(stakeAmount, { suffix: false })} pts
            </span>
          </div>
          <Link
            to={resumeHref}
            className={cn(
              'inline-flex items-center gap-1 font-label-sm text-label-sm font-medium transition-transform group-hover:translate-x-0.5',
              atRisk ? 'text-error' : 'text-primary',
            )}
          >
            <span>{daysRemaining > 0 ? 'Resume' : 'Review'}</span>
            <MaterialIcon name="arrow_forward" className="text-[16px]" />
          </Link>
        </div>
      </div>
    </div>
  );
}

