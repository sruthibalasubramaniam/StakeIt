import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { enrollmentApi, learningApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock, MetricRow } from '../../components/ui/data';
import { QuestionRunner, ResultReview, type AnswerMap } from '../../components/domain/QuestionRunner';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatPercent } from '../../utils/format';
import type { AssessmentPayload, SubmissionResult } from '../../types/api';

/**
 * Module assessment and final test runner.
 *
 * The final test additionally returns a settlement receipt when it passes — the
 * course is settled server-side inside one transaction, and this screen simply
 * shows the result.
 */
export function AssessmentRunner({ assessmentId }: { assessmentId: string }) {
  const { enrollmentId = '' } = useParams<{ enrollmentId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const entry = useAsync(() => enrollmentApi.detail(enrollmentId), [enrollmentId]);
  const attemptId = entry.data?.attemptId ?? '';

  const assessment = useAsync(() => learningApi.assessment(attemptId, assessmentId), [attemptId, assessmentId], {
    enabled: Boolean(attemptId && assessmentId),
  });

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);

  useDocumentTitle(assessment.data?.assessment.title ?? 'Assessment');

  if (entry.error) return <ErrorBlock message={entry.error} onRetry={() => void entry.refetch()} />;
  if (assessment.loading || entry.loading) return <LoadingBlock label="Loading assessment…" rows={4} />;
  if (assessment.error || !assessment.data) {
    return (
      <div className="flex flex-col gap-space-md">
        <ErrorBlock
          title={assessment.error?.includes('final') ? 'The final test is locked' : 'This assessment is not available'}
          message={
            assessment.error ??
            'The assessment is locked until the preceding content is complete. The API enforces this regardless of the interface.'
          }
          onRetry={() => void assessment.refetch()}
        />
        <Link to={`/learn/${enrollmentId}`} className="w-fit">
          <Button variant="secondary" icon="arrow_back">
            Back to course
          </Button>
        </Link>
      </div>
    );
  }

  const data: AssessmentPayload = assessment.data;
  const attemptsRemaining = data.attemptInfo.attemptsRemaining;

  const submit = async () => {
    setSubmitting(true);
    try {
      const response = await learningApi.submitAssessment(attemptId, assessmentId, answers);
      setResult(response);

      if (response.settlement) {
        toast.success('Course completed', `${response.settlement.totalCredited} points credited to your wallet.`);
        navigate(`/learn/${enrollmentId}/completion`, { replace: true });
        return;
      }

      toast.success(
        response.submission.passed ? 'Assessment passed' : 'Assessment submitted',
        response.submission.passed
          ? `You scored ${response.submission.percentage}%.`
          : `You scored ${response.submission.percentage}%. ${response.passingScore}% is required to pass.`,
      );
      await assessment.refetch();
    } catch (caught) {
      toast.error('Could not submit this assessment', errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="flex flex-col gap-space-lg">
        <Link
          to={`/learn/${enrollmentId}`}
          className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" className="text-[16px]" />
          Back to course
        </Link>

        <ResultReview
          review={result.review}
          passingScore={result.passingScore}
          percentage={result.submission.percentage}
          passed={result.submission.passed}
          correctCount={result.correctCount}
          totalQuestions={result.totalQuestions}
          hasPendingReview={result.hasPendingReview}
        />

        {result.missedMinimum ? (
          <Alert tone="error" title="Minimum final-test score not met">
            The instructor set a minimum final-test score of {result.minFinalTestScore}%. Your score of{' '}
            {formatPercent(result.submission.percentage, 1)} does not clear it, so the course cannot be completed yet even though
            your weighted score may be higher.
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title={result.submission.passed ? 'Next step' : 'Retry'}
            subtitle={
              result.submission.passed
                ? result.isFinal
                  ? 'Your course is being settled.'
                  : 'The next module is now unlocked.'
                : `${result.passingScore}% is required to pass.`
            }
          />
          <Divider />
          <div className="flex flex-wrap items-center justify-between gap-space-md p-space-lg">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              {attemptsRemaining === null ? 'Unlimited attempts.' : `${attemptsRemaining} attempt(s) remaining.`}
            </span>
            <div className="flex items-center gap-space-sm">
              <Link to={`/learn/${enrollmentId}`}>
                <Button variant="secondary" icon="list">
                  Back to curriculum
                </Button>
              </Link>
              {!result.submission.passed && result.mayRetry ? (
                <Button
                  icon="restart_alt"
                  onClick={() => {
                    setAnswers({});
                    setResult(null);
                  }}
                >
                  Retry assessment
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-lg">
      <Link
        to={`/learn/${enrollmentId}`}
        className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
      >
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to course
      </Link>

      <div className="flex flex-col gap-space-xs">
        <span className="micro-label text-on-surface-variant">
          {data.isFinal ? 'Final course assessment' : `Module assessment · ${data.module?.title ?? ''}`}
        </span>
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">{data.assessment.title}</h1>
        {data.assessment.description ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{data.assessment.description}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-space-sm">
        <Chip tone="info" icon="assignment">
          {data.questions.length} question(s)
        </Chip>
        <Chip tone="info">{data.assessment.passingScore}% to pass</Chip>
        {data.assessment.minFinalTestScore !== null ? (
          <Chip tone="stake">minimum {data.assessment.minFinalTestScore}% on this test</Chip>
        ) : null}
        {attemptsRemaining !== null ? <Chip tone="info">{attemptsRemaining} attempt(s) remaining</Chip> : null}
      </div>

      {data.isFinal ? (
        <Card>
          <CardHeader
            title="How your final score is calculated"
            subtitle="Configured by the instructor — shown so the outcome is never a surprise."
          />
          <Divider />
          <div className="px-space-lg py-space-md">
            <MetricRow label="Module score weight" value={`${data.course.moduleWeight}%`} />
            <MetricRow label="Final test weight" value={`${data.course.finalTestWeight}%`} />
            <MetricRow
              label="Performance bonus threshold"
              value={`${data.course.performanceThreshold}%`}
              sub={`Worth ${data.course.performanceBonus} points if cleared`}
            />
            {data.assessment.minFinalTestScore !== null ? (
              <MetricRow
                label="Minimum final-test score"
                value={`${data.assessment.minFinalTestScore}%`}
                sub="Hard floor regardless of the weighted score"
              />
            ) : null}
            <MetricRow
              label="Formula"
              value={`module × ${data.course.moduleWeight}% + test × ${data.course.finalTestWeight}%`}
            />
          </div>
        </Card>
      ) : null}

      {data.attemptInfo.bestPercentage !== null && !data.attemptInfo.passed ? (
        <Alert tone="warning" title="Previous attempt did not pass">
          Your best result so far is {data.attemptInfo.bestPercentage}%. This item gates the next module.
        </Alert>
      ) : null}

      <QuestionRunner
        meta={
          <>
            <span className="font-mono text-label-xs text-on-surface-variant">{data.course.code}</span>
            <span className="text-outline-variant">/</span>
            <span className="font-label-sm text-label-sm text-on-surface">
              {data.isFinal ? 'Final test' : data.module?.title ?? 'Module assessment'}
            </span>
          </>
        }
        questions={data.questions}
        answers={answers}
        onAnswer={(questionId, optionIds) => setAnswers((current) => ({ ...current, [questionId]: optionIds }))}
        onSubmit={() => void submit()}
        submitting={submitting}
        submitLabel={data.isFinal ? 'Submit final test' : 'Submit assessment'}
      />
    </div>
  );
}

export function AssessmentPage() {
  const { assessmentId = '' } = useParams<{ enrollmentId: string; assessmentId: string }>();
  return <AssessmentRunner assessmentId={assessmentId} />;
}
