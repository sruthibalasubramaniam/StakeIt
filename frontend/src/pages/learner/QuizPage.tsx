import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { enrollmentApi, learningApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock } from '../../components/ui/data';
import { QuestionRunner, ResultReview, type AnswerMap } from '../../components/domain/QuestionRunner';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import type { GradedQuestionReview } from '../../types/api';

interface QuizSubmissionState {
  percentage: number;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
  hasPendingReview: boolean;
  passingScore: number;
  review: GradedQuestionReview[];
  attemptsRemaining: number | null;
}

/**
 * Module quiz. Answers are collected locally and graded by the API; the
 * percentage, pass/fail and correct answers all come from the response.
 */
export function QuizPage() {
  const { enrollmentId = '', quizId = '' } = useParams<{ enrollmentId: string; quizId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const entry = useAsync(() => enrollmentApi.detail(enrollmentId), [enrollmentId]);
  const attemptId = entry.data?.attemptId ?? '';

  const quiz = useAsync(() => learningApi.quiz(attemptId, quizId), [attemptId, quizId], {
    enabled: Boolean(attemptId && quizId),
  });

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizSubmissionState | null>(null);

  useDocumentTitle(quiz.data?.quiz.title ?? 'Quiz');

  if (entry.error) return <ErrorBlock message={entry.error} onRetry={() => void entry.refetch()} />;
  if (quiz.loading || entry.loading) return <LoadingBlock label="Loading quiz…" rows={4} />;
  if (quiz.error || !quiz.data) {
    return (
      <div className="flex flex-col gap-space-md">
        <ErrorBlock
          title="This quiz is not available"
          message={
            quiz.error ??
            'The quiz is locked until the preceding content is complete. The API enforces this regardless of the interface.'
          }
          onRetry={() => void quiz.refetch()}
        />
        <Link to={`/learn/${enrollmentId}`} className="w-fit">
          <Button variant="secondary" icon="arrow_back">
            Back to course
          </Button>
        </Link>
      </div>
    );
  }

  const data = quiz.data;
  const attemptsExhausted =
    data.attemptInfo.attemptsRemaining !== null && data.attemptInfo.attemptsRemaining <= 0 && !data.attemptInfo.passed;

  const submit = async () => {
    setSubmitting(true);
    try {
      const response = await learningApi.submitQuiz(attemptId, quizId, answers);
      setResult({
        percentage: response.attempt.percentage,
        passed: response.attempt.passed,
        correctCount: response.correctCount,
        totalQuestions: response.totalQuestions,
        hasPendingReview: response.hasPendingReview,
        passingScore: response.passingScore,
        review: response.review,
        attemptsRemaining: data.attemptInfo.attemptsRemaining === null ? null : data.attemptInfo.attemptsRemaining - 1,
      });
      toast.success(
        response.attempt.passed ? 'Quiz passed' : 'Quiz submitted',
        response.attempt.passed
          ? `You scored ${response.attempt.percentage}%. The next item is unlocked.`
          : `You scored ${response.attempt.percentage}%. ${response.passingScore}% is required to pass.`,
      );
      await quiz.refetch();
    } catch (caught) {
      toast.error('Could not submit this quiz', errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const attemptsRemaining = result.attemptsRemaining;

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
          percentage={result.percentage}
          passed={result.passed}
          correctCount={result.correctCount}
          totalQuestions={result.totalQuestions}
          hasPendingReview={result.hasPendingReview}
        />

        <Card>
          <CardHeader
            title={result.passed ? 'Next step' : 'Retry'}
            subtitle={
              result.passed
                ? 'The next required item in this module is now unlocked.'
                : `You need ${result.passingScore}% to pass this quiz.`
            }
          />
          <Divider />
          <div className="flex flex-wrap items-center justify-between gap-space-md p-space-lg">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              {attemptsRemaining === null
                ? 'Unlimited attempts on this quiz.'
                : `${attemptsRemaining} attempt(s) remaining.`}
            </span>
            <div className="flex items-center gap-space-sm">
              <Link to={`/learn/${enrollmentId}`}>
                <Button variant="secondary" icon="list">
                  Back to curriculum
                </Button>
              </Link>
              {!result.passed && (attemptsRemaining === null || attemptsRemaining > 0) ? (
                <Button
                  icon="restart_alt"
                  onClick={() => {
                    setAnswers({});
                    setResult(null);
                  }}
                >
                  Retry quiz
                </Button>
              ) : null}
              {result.passed ? (
                <Button iconRight="arrow_forward" onClick={() => navigate(`/learn/${enrollmentId}`)}>
                  Continue module
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
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">{data.quiz.title}</h1>
        {data.quiz.description ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{data.quiz.description}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-space-sm">
        <Chip tone="info" icon="quiz">
          {data.questions.length} question(s)
        </Chip>
        <Chip tone="info">{data.quiz.passingScore}% to pass</Chip>
        <Chip tone={data.attemptInfo.passed ? 'earned' : 'stake'}>
          {data.attemptInfo.passed ? 'already passed' : `${data.attemptInfo.attemptsUsed} attempt(s) used`}
        </Chip>
        {data.attemptInfo.attemptsRemaining !== null ? (
          <Chip tone="info">{data.attemptInfo.attemptsRemaining} remaining</Chip>
        ) : null}
        {data.attemptInfo.bestPercentage !== null ? (
          <Chip tone="neutral">best {data.attemptInfo.bestPercentage}%</Chip>
        ) : null}
      </div>

      {attemptsExhausted ? (
        <Alert tone="error" title="No attempts remaining">
          You have used every attempt for this quiz. Contact your instructor if you need this reset.
        </Alert>
      ) : null}

      {data.attemptInfo.bestPercentage !== null && !data.attemptInfo.passed ? (
        <Alert tone="warning" title="Previous attempt did not pass">
          Your best result so far is {data.attemptInfo.bestPercentage}%. The quiz stays locked as a gate until it is passed.
        </Alert>
      ) : null}

      <QuestionRunner
        meta={
          <>
            <span className="font-mono text-label-xs text-on-surface-variant">
              {data.module.title}
            </span>
            <span className="text-outline-variant">/</span>
            <span className="font-label-sm text-label-sm text-on-surface">Module quiz</span>
          </>
        }
        questions={data.questions}
        answers={answers}
        onAnswer={(questionId, optionIds) => setAnswers((current) => ({ ...current, [questionId]: optionIds }))}
        onSubmit={() => void submit()}
        submitting={submitting}
        submitLabel="Submit quiz"
        readOnly={attemptsExhausted}
      />
    </div>
  );
}
