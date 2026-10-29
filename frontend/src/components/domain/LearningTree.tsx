import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Chip, MaterialIcon, ProgressBar } from '../ui/core';
import { formatPercent, formatPoints } from '../../utils/format';
import type { ContentView, LearningState, ModuleView } from '../../types/api';

const CONTENT_ICONS: Record<string, string> = {
  VIDEO: 'play_circle',
  READING: 'article',
  QUIZ: 'quiz',
  MODULE_ASSESSMENT: 'assignment',
  CODING: 'code',
  SUBJECTIVE: 'edit_note',
};

/**
 * The curriculum tree from `course_page`.
 *
 * Every state the backend can return has an explicit visual treatment:
 * completed, current+unlocked ("Continue"), unlocked+reviewable, and locked.
 */
export function LearningTree({
  modules,
  finalAssessment,
  enrollmentId,
  className,
}: {
  modules: ModuleView[];
  finalAssessment: LearningState['finalAssessment'];
  enrollmentId: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-space-xl', className)}>
      {modules.map((module, index) => (
        <ModuleSection key={module.id} module={module} index={index} enrollmentId={enrollmentId} />
      ))}

      {finalAssessment ? (
        <section>
          <div className="flex items-center justify-between border-b border-outline-variant pb-space-sm">
            <div className="flex items-center gap-space-md">
              <span
                className={cn(
                  'font-mono text-label-sm tabular',
                  finalAssessment.isUnlocked ? 'text-on-surface-variant' : 'text-[#94A3B8]',
                )}
              >
                {String(modules.length + 1).padStart(2, '0')}
              </span>
              <h2 className={cn('font-headline-sm text-headline-sm', finalAssessment.isUnlocked ? 'text-on-surface' : 'text-[#94A3B8]')}>
                {finalAssessment.title}
              </h2>
            </div>
            <div className="flex items-center gap-space-sm">
              {finalAssessment.isCompleted ? (
                <span className="font-label-sm text-label-sm text-secondary">Passed</span>
              ) : finalAssessment.isUnlocked ? (
                <span className="font-label-sm text-label-sm text-on-surface-variant">Unlocked</span>
              ) : (
                <MaterialIcon name="lock" className="text-[16px] text-[#94A3B8]" />
              )}
            </div>
          </div>

          <div className="mt-space-sm">
            {finalAssessment.isUnlocked ? (
              <Link
                to={`/learn/${enrollmentId}/final-test`}
                className="group flex items-center justify-between rounded px-space-md py-space-sm transition-colors hover:bg-primary-fixed/50"
              >
                <span className="flex items-center gap-space-md">
                  <MaterialIcon name="school" className="text-[18px] text-on-surface-variant" />
                  <span className="font-label-md text-label-md text-on-surface">
                    Final Course Assessment · {finalAssessment.passingScore}% to pass
                  </span>
                </span>
                <span className="flex items-center gap-space-md">
                  {finalAssessment.bestPercentage !== null ? (
                    <span className="font-mono text-label-xs tabular text-on-surface-variant">
                      Best {formatPercent(finalAssessment.bestPercentage, 1)}
                    </span>
                  ) : null}
                  <span className="rounded bg-primary-container px-space-md py-1 font-label-sm text-label-sm text-on-primary">
                    {finalAssessment.isCompleted ? 'Review' : 'Start'}
                  </span>
                </span>
              </Link>
            ) : (
              <p className="px-space-md font-body-sm text-body-sm text-on-surface-variant">
                {finalAssessment.lockReason ?? 'Complete every required module to unlock the final test.'}
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ModuleSection({ module, index, enrollmentId }: { module: ModuleView; index: number; enrollmentId: string }) {
  const locked = !module.isUnlocked;

  return (
    <section>
      <div className="flex items-center justify-between border-b border-outline-variant pb-space-sm">
        <div className="flex items-center gap-space-md">
          <span className={cn('font-mono text-label-sm tabular', locked ? 'text-[#94A3B8]' : 'text-on-surface-variant')}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <h2 className={cn('font-headline-sm text-headline-sm', locked ? 'text-[#94A3B8]' : 'text-on-surface')}>{module.title}</h2>
        </div>
        <div className="flex items-center gap-space-md">
          {module.isCompleted ? (
            <span className="font-label-sm text-label-sm text-secondary">Completed</span>
          ) : locked ? (
            <MaterialIcon name="lock" className="text-[16px] text-[#94A3B8]" />
          ) : (
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              In Progress · {module.completedCount}/{module.requiredCount}
            </span>
          )}
        </div>
      </div>

      <div className="mt-space-sm flex flex-col">
        {module.contents.map((content) => (
          <ContentRow key={content.id} content={content} enrollmentId={enrollmentId} moduleLocked={locked} />
        ))}
      </div>
    </section>
  );
}

function ContentRow({
  content,
  enrollmentId,
  moduleLocked,
}: {
  content: ContentView;
  enrollmentId: string;
  moduleLocked: boolean;
}) {
  const locked = moduleLocked || !content.isUnlocked;
  const isCurrent = content.isCurrent && !content.isCompleted;

  const href = (() => {
    if (content.type === 'QUIZ' && content.quiz) return `/learn/${enrollmentId}/quiz/${content.quiz.id}`;
    if (content.type === 'MODULE_ASSESSMENT' && content.assessment) {
      return `/learn/${enrollmentId}/assessment/${content.assessment.id}`;
    }
    return `/learn/${enrollmentId}/content/${content.id}`;
  })();

  const rightLabel = (() => {
    if (locked) return 'Locked';
    if (content.isCompleted) return content.type === 'VIDEO' ? 'Review' : 'Completed';
    if (content.quiz?.bestPercentage !== null && content.quiz?.bestPercentage !== undefined) {
      return `Best ${formatPercent(content.quiz.bestPercentage)}`;
    }
    if (content.assessment?.bestPercentage !== null && content.assessment?.bestPercentage !== undefined) {
      return `Best ${formatPercent(content.assessment.bestPercentage)}`;
    }
    return null;
  })();

  return (
    <div
      className={cn(
        'group flex flex-col justify-between gap-space-sm rounded px-space-md py-space-sm transition-colors sm:flex-row sm:items-center',
        isCurrent ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low',
      )}
    >
      <div className="flex min-w-0 items-center gap-space-md">
        {locked ? (
          <MaterialIcon name="lock" className="text-[16px] text-[#94A3B8]" />
        ) : content.isCompleted ? (
          <MaterialIcon name="check_circle" filled className="text-[18px] text-secondary" />
        ) : (
          <MaterialIcon name={CONTENT_ICONS[content.type] ?? 'circle'} className="text-[18px] text-on-surface-variant" />
        )}

        <div className="flex min-w-0 flex-col">
          <span className={cn('truncate font-label-md text-label-md', locked ? 'text-[#94A3B8] opacity-70' : 'text-on-surface')}>
            {content.title}
          </span>
          <span className="flex items-center gap-space-sm font-label-xs text-label-xs text-on-surface-variant">
            {content.isRequired ? null : <span className="opacity-70">optional</span>}
            {content.type === 'VIDEO' && content.progress.validWatchPercent > 0 && !content.isCompleted ? (
              <span className="metric">
                {formatPercent(content.progress.validWatchPercent)} watched ({content.requiredWatchPercent ?? 90}% required)
              </span>
            ) : null}
            {content.estimatedMinutes ? <span>{content.estimatedMinutes} min</span> : null}
            {content.progress.reading ? (
              <span className="metric">
                {content.progress.reading.completedSections}/{content.progress.reading.totalSections} sections
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-space-md pl-7 sm:pl-0">
        {rightLabel ? (
          <span className={cn('font-label-xs text-label-xs', locked ? 'text-[#94A3B8]' : 'text-on-surface-variant')}>{rightLabel}</span>
        ) : null}

        {locked ? null : isCurrent ? (
          <Link
            to={href}
            className="rounded bg-primary-container px-space-md py-1 font-label-sm text-label-sm text-on-primary transition-colors hover:bg-primary"
          >
            Continue
          </Link>
        ) : (
          <Link to={href} className="font-label-sm text-label-sm font-medium text-primary hover:underline">
            {content.isCompleted ? 'Review' : 'Open'}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Module-level progress rail used beside the player. */
export function ModuleRail({
  modules,
  activeModuleId,
  enrollmentId,
  overallProgressPercent,
}: {
  modules: ModuleView[];
  activeModuleId?: string;
  enrollmentId: string;
  overallProgressPercent: number;
}) {
  return (
    <nav aria-label="Course structure" className="flex flex-col">
      <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
        <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
          <span>Overall progress</span>
          <span className="metric font-medium text-on-surface">{formatPercent(overallProgressPercent)}</span>
        </div>
        <ProgressBar value={overallProgressPercent} tone={overallProgressPercent >= 100 ? 'success' : 'primary'} />
      </div>

      <div className="h-px w-full bg-surface-container" />

      <ul className="flex flex-col py-space-sm">
        {modules.map((module, index) => (
          <li key={module.id}>
            <Link
              to={`/learn/${enrollmentId}/content/${module.contents[0]?.id ?? ''}`}
              aria-current={module.id === activeModuleId ? 'true' : undefined}
              className={cn(
                'flex items-start gap-space-md px-space-lg py-space-sm transition-colors',
                module.id === activeModuleId ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low',
                !module.isUnlocked && 'opacity-60',
              )}
            >
              <span className="mt-0.5 font-mono text-label-xs tabular text-on-surface-variant">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn('truncate font-label-sm text-label-sm', module.isCompleted ? 'text-on-surface' : 'text-on-surface')}>
                  {module.title}
                </span>
                <span className="flex items-center gap-space-sm font-label-xs text-label-xs text-on-surface-variant">
                  {module.isCompleted ? (
                    <span className="flex items-center gap-1 text-secondary">
                      <MaterialIcon name="check_circle" filled className="text-[12px]" />
                      Completed
                    </span>
                  ) : module.isUnlocked ? (
                    <span className="metric">
                      {module.completedCount}/{module.requiredCount} done
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <MaterialIcon name="lock" className="text-[12px]" />
                      Locked
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Compact stake/deadline sidebar used on learning screens. */
export function LearningSidebarMeta({
  code,
  daysRemaining,
  deadline,
  lockedStake,
  riskLabel,
  atRisk,
}: {
  code: string;
  daysRemaining: number;
  deadline: string;
  lockedStake: number;
  riskLabel?: string;
  atRisk?: boolean;
}) {
  return (
    <div className="flex flex-col gap-space-md px-space-lg py-space-md">
      <div className="flex items-center justify-between">
        <span className="font-mono text-label-xs text-on-surface-variant">{code}</span>
        {riskLabel ? (
          <Chip tone={atRisk ? 'risk' : 'stake'}>{riskLabel}</Chip>
        ) : null}
      </div>
      <div className="flex items-center justify-between font-label-sm text-label-sm">
        <span className="text-on-surface-variant">Deadline</span>
        <span className={cn(atRisk ? 'font-semibold text-error' : 'text-on-surface')}>
          {daysRemaining} day(s) · {new Date(deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <div className="flex items-center justify-between font-label-sm text-label-sm">
        <span className="text-on-surface-variant">Active stake</span>
        <span className="font-mono tabular text-on-surface">{formatPoints(lockedStake, { suffix: false })} pts</span>
      </div>
    </div>
  );
}
