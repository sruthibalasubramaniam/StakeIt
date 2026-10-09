import { Link, useParams } from 'react-router-dom';
import { enrollmentApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Divider, MaterialIcon, ProgressBar } from '../../components/ui/core';
import { Card, CardHeader, ErrorBlock, LoadingBlock, SectionHeader } from '../../components/ui/data';
import { AssessmentRunner } from './AssessmentPage';
import { formatPercent } from '../../utils/format';

/**
 * Final course test.
 *
 * The lock is decided by the backend: if the attempt's modules are not all
 * complete, the assessment endpoint returns `FINAL_TEST_LOCKED` and this page
 * explains what is outstanding instead of rendering a dead test.
 */
export function FinalTestPage() {
  const { enrollmentId = '' } = useParams<{ enrollmentId: string }>();
  useDocumentTitle('Final test');

  const state = useAsync(() => enrollmentApi.learningState(enrollmentId), [enrollmentId]);

  if (state.loading) return <LoadingBlock label="Checking final test eligibility…" rows={4} />;
  if (state.error || !state.data) {
    return <ErrorBlock title="Could not load the final test" message={state.error} onRetry={() => void state.refetch()} />;
  }

  const { finalAssessment, modules, progress, course } = state.data;

  if (!finalAssessment) {
    return (
      <ErrorBlock
        title="No final assessment configured"
        message="This course does not have a final assessment yet. An instructor needs to add one before the course can be completed."
      />
    );
  }

  if (finalAssessment.passed) {
    return (
      <div className="flex flex-col gap-space-lg">
        <SectionHeader eyebrow="Final course assessment" title={finalAssessment.title} />
        <Card>
          <div className="flex flex-col gap-space-md p-space-lg">
            <span className="flex items-center gap-1.5 font-label-md text-label-md text-secondary">
              <MaterialIcon name="check_circle" filled className="text-[18px]" />
              Final test passed
            </span>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              You scored {finalAssessment.bestPercentage !== null ? formatPercent(finalAssessment.bestPercentage, 1) : '—'} across{' '}
              {finalAssessment.attemptsUsed} attempt(s). This course has been settled.
            </p>
            <div className="flex flex-wrap items-center gap-space-sm">
              <Link to={`/learn/${enrollmentId}/completion`}>
                <Button icon="receipt_long">View completion receipt</Button>
              </Link>
              <Link to={`/learn/${enrollmentId}`}>
                <Button variant="secondary" icon="list">
                  Back to curriculum
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!finalAssessment.isUnlocked) {
    const outstanding = modules.filter((module) => module.isRequired && !module.isCompleted);

    return (
      <div className="flex flex-col gap-space-lg">
        <SectionHeader eyebrow="Final course assessment" title="Final test locked" />

        <Card>
          <CardHeader
            title="Complete every required module first"
            subtitle={finalAssessment.lockReason ?? 'The final test opens once all required modules are passed.'}
            action={<MaterialIcon name="lock" className="text-on-surface-variant" />}
          />
          <Divider />
          <div className="flex flex-col gap-space-md p-space-lg">
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
                <span>Overall course progress</span>
                <span className="metric font-medium text-on-surface">{formatPercent(progress.overallProgressPercent)}</span>
              </div>
              <ProgressBar value={progress.overallProgressPercent} tone="primary" label="Overall progress" />
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                {progress.completedRequired} of {progress.totalRequired} required items complete
              </span>
            </div>

            <Divider />

            <div className="flex flex-col gap-space-sm">
              <span className="micro-label text-on-surface-variant">Outstanding modules</span>
              {outstanding.length === 0 ? (
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  All modules report complete — refresh to re-check the unlock state.
                </span>
              ) : (
                <ul className="flex flex-col divide-y divide-outline-variant">
                  {outstanding.map((module) => (
                    <li key={module.id} className="flex items-center justify-between gap-space-md py-space-sm">
                      <span className="flex items-center gap-space-md">
                        <MaterialIcon name="lock" className="text-[16px] text-[#94A3B8]" />
                        <span className="font-label-md text-label-md text-on-surface">{module.title}</span>
                      </span>
                      <span className="font-mono text-label-xs tabular text-on-surface-variant">
                        {module.completedCount}/{module.requiredCount} done
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Divider />

            <div className="flex flex-col gap-space-xs">
              <span className="micro-label text-on-surface-variant">Grading configuration</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                Final score = module score × {course.moduleWeight}% + final test × {course.finalTestWeight}%.
                {course.minFinalTestScore !== null
                  ? ` You must score at least ${course.minFinalTestScore}% on the final test itself.`
                  : ''}{' '}
                Performance bonus is awarded at {course.performanceThreshold}% or above.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-space-sm pt-space-xs">
              <Link to={`/learn/${enrollmentId}`}>
                <Button iconRight="arrow_forward">Continue learning</Button>
              </Link>
              <Button variant="secondary" icon="refresh" onClick={() => void state.refetch()}>
                Re-check eligibility
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Unlocked and not yet passed — render the real test.
  return <AssessmentRunner assessmentId={finalAssessment.id} />;
}
