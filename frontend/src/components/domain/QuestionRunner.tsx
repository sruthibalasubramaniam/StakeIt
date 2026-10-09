import { useMemo, useState } from 'react';
import { cn } from '../../utils/cn';
import { Alert } from '../ui/data';
import { Button, Chip, Divider, MaterialIcon, ProgressBar } from '../ui/core';
import { formatPercent } from '../../utils/format';
import type { GradedQuestionReview, QuizQuestion } from '../../types/api';

export type AnswerMap = Record<string, string[]>;

const TYPE_LABELS: Record<string, string> = {
  SINGLE_CHOICE: 'Single choice',
  MULTI_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True / false',
  SHORT_TEXT: 'Short answer',
  CODING: 'Coding exercise',
  SUBJECTIVE: 'Written response',
};

/**
 * Shared runner for quizzes, module assessments and the final test — the
 * `quiz_screen` design: progress rail, question card, option list with detail
 * lines, autosave note, and a results view with explanations.
 *
 * Grading is never computed here: this component only collects selections and
 * renders whatever the API returns.
 */
export function QuestionRunner({
  meta,
  questions,
  answers,
  onAnswer,
  onSubmit,
  submitting,
  submitLabel = 'Submit',
  readOnly = false,
  className,
}: {
  meta?: React.ReactNode;
  questions: QuizQuestion[];
  answers: AnswerMap;
  onAnswer: (questionId: string, optionIds: string[]) => void;
  onSubmit?: () => void;
  submitting?: boolean;
  submitLabel?: string;
  readOnly?: boolean;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const total = questions.length;
  const question = questions[index];
  const answeredCount = useMemo(
    () => questions.filter((entry) => (answers[entry.id] ?? []).length > 0).length,
    [questions, answers],
  );

  if (total === 0) {
    return (
      <Alert tone="warning" title="No questions yet">
        This instrument has no questions configured. An instructor needs to add them before it can be attempted.
      </Alert>
    );
  }

  if (!question) return null;

  const selected = answers[question.id] ?? [];
  const isMulti = question.type === 'MULTI_CHOICE';
  const isFreeText = ['SHORT_TEXT', 'CODING', 'SUBJECTIVE'].includes(question.type);
  const completionPercent = Math.round(((index + 1) / total) * 100);

  const toggleOption = (optionId: string) => {
    if (readOnly) return;
    if (isMulti) {
      const next = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
      onAnswer(question.id, next);
    } else {
      onAnswer(question.id, selected.includes(optionId) ? [] : [optionId]);
    }
  };

  const isLast = index === total - 1;

  return (
    <div className={cn('flex flex-col gap-space-lg', className)}>
      {/* Breadcrumb / stake-at-risk row */}
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-sm font-label-sm text-label-sm">
          {meta}
        </div>
        {!readOnly ? (
          <Chip tone="info" icon="lock">
            {`Stake at risk`}
          </Chip>
        ) : null}
      </div>

      <div className="surface-card">
        {/* Question progress */}
        <div className="flex items-center justify-between px-space-lg py-space-md">
          <span className="font-label-sm text-label-sm text-on-surface-variant">
            Question <span className="metric text-on-surface">{String(index + 1).padStart(2, '0')}</span> of{' '}
            <span className="metric text-on-surface">{String(total).padStart(2, '0')}</span>
          </span>
          <span className="micro-label text-on-surface-variant">{completionPercent}% complete</span>
        </div>
        <div className="px-space-lg">
          <ProgressBar value={completionPercent} tone="primary" label="Question progress" />
        </div>

        <div className="flex flex-col gap-space-lg px-space-lg py-space-lg">
          <div className="flex flex-col gap-space-sm">
            <span className="micro-label text-on-surface-variant">{TYPE_LABELS[question.type] ?? question.type}</span>
            <h2 className="font-headline-sm text-headline-sm leading-snug text-on-surface">{question.prompt}</h2>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              {question.points} point{question.points === 1 ? '' : 's'}
              {isMulti ? ' · select all that apply' : ''}
            </span>
          </div>

          {isFreeText ? (
            <textarea
              rows={6}
              value={selected[0] ?? ''}
              disabled={readOnly}
              onChange={(event) => onAnswer(question.id, event.target.value ? [event.target.value] : [])}
              placeholder={
                question.type === 'CODING'
                  ? 'Paste your implementation. A sandbox evaluator can grade this automatically.'
                  : 'Write your response. Subjective answers are reviewed by a human or an AI rubric.'
              }
              className="w-full rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm font-body-md text-body-md focus:border-primary-container focus:outline-none focus:ring-2 focus:ring-primary-container/10"
            />
          ) : (
            <div className="flex flex-col gap-space-xs" role={isMulti ? 'group' : 'radiogroup'} aria-label="Answer options">
              {question.options.map((option) => {
                const active = selected.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role={isMulti ? 'checkbox' : 'radio'}
                    aria-checked={active}
                    disabled={readOnly}
                    onClick={() => toggleOption(option.id)}
                    className={cn(
                      'flex items-start gap-space-md rounded px-space-md py-space-sm text-left transition-colors',
                      active ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low',
                      readOnly && 'cursor-default',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border-[1.5px]',
                        isMulti ? 'rounded-sm' : 'rounded-full',
                        active ? 'border-primary-container bg-primary-container' : 'border-[#CBD5E1] bg-transparent',
                      )}
                    >
                      {active ? (
                        isMulti ? (
                          <MaterialIcon name="check" className="text-[12px] text-on-primary" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-on-primary" />
                        )
                      ) : null}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface">{option.label}</span>
                      {option.detail ? (
                        <span className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{option.detail}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-outline-variant px-space-lg py-space-md">
          <div className="flex flex-col gap-space-md sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
              <MaterialIcon name="info" className="text-[14px]" />
              {readOnly
                ? 'Attempt submitted.'
                : 'Changes auto-saved locally. All stakes settled on final submission.'}
            </span>
            <div className="flex items-center gap-space-sm">
              <Button variant="secondary" icon="chevron_left" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>
                Previous
              </Button>
              {isLast ? (
                onSubmit ? (
                  <Button iconRight="send" loading={submitting} onClick={onSubmit} disabled={answeredCount === 0}>
                    {submitLabel}
                  </Button>
                ) : null
              ) : (
                <Button iconRight="arrow_forward" onClick={() => setIndex((value) => value + 1)}>
                  Next Question
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Question palette */}
      <div className="flex flex-wrap items-center gap-space-sm">
        {questions.map((entry, entryIndex) => {
          const answered = (answers[entry.id] ?? []).length > 0;
          const isCurrent = entryIndex === index;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setIndex(entryIndex)}
              aria-label={`Go to question ${entryIndex + 1}${answered ? ' (answered)' : ''}`}
              aria-current={isCurrent ? 'true' : undefined}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded border font-mono text-label-xs tabular transition-colors',
                isCurrent
                  ? 'border-primary-container bg-primary-container text-on-primary'
                  : answered
                    ? 'border-secondary-fixed-dim bg-secondary-fixed/40 text-secondary'
                    : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low',
              )}
            >
              {entryIndex + 1}
            </button>
          );
        })}
        <span className="ml-space-sm font-label-xs text-label-xs text-on-surface-variant">
          {answeredCount}/{total} answered
        </span>
      </div>
    </div>
  );
}

/**
 * Results view: per-question correctness, the correct option, and the
 * instructor's explanation. Everything displayed comes from the API response.
 */
export function ResultReview({
  review,
  passingScore,
  percentage,
  passed,
  correctCount,
  totalQuestions,
  hasPendingReview,
  className,
}: {
  review: GradedQuestionReview[];
  passingScore: number;
  percentage: number;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
  hasPendingReview: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-space-lg', className)}>
      <div className="surface-card flex flex-col gap-space-md px-space-lg py-space-lg">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <span className="micro-label text-on-surface-variant">Result</span>
            <span className={cn('font-headline-lg text-headline-lg tabular', passed ? 'text-secondary' : 'text-error')}>
              {formatPercent(percentage, 1)}
            </span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              {correctCount} of {totalQuestions} correct · {passingScore}% required to pass
            </span>
          </div>
          <Chip tone={passed ? 'earned' : 'risk'} icon={passed ? 'check_circle' : 'cancel'}>
            {passed ? 'Passed' : 'Not passed'}
          </Chip>
        </div>
        {hasPendingReview ? (
          <Alert tone="warning" title="Awaiting review">
            This submission contains written or coding answers. It is recorded as <strong>pending review</strong> and cannot
            gate your progress until an instructor or evaluator grades it.
          </Alert>
        ) : null}
      </div>

      <div className="flex flex-col gap-space-md">
        {review.map((item, index) => (
          <div key={item.questionId} className="surface-card px-space-lg py-space-md">
            <div className="flex items-start justify-between gap-space-md">
              <div className="flex items-start gap-space-md">
                <span className="mt-0.5 font-mono text-label-xs tabular text-on-surface-variant">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-col gap-space-xs">
                  <p className="font-label-md text-label-md text-on-surface">{item.prompt}</p>
                  {item.pendingReview ? (
                    <span className="font-label-xs text-label-xs text-on-surface-variant">Pending review</span>
                  ) : (
                    <span className={cn('font-label-xs text-label-xs', item.correct ? 'text-secondary' : 'text-error')}>
                      {item.correct ? 'Correct' : 'Incorrect'} · {item.awarded}/{item.maxPoints} points
                    </span>
                  )}
                </div>
              </div>
              <MaterialIcon
                name={item.pendingReview ? 'hourglass_empty' : item.correct ? 'check_circle' : 'cancel'}
                filled={!item.pendingReview}
                className={cn('text-[18px]', item.pendingReview ? 'text-on-surface-variant' : item.correct ? 'text-secondary' : 'text-error')}
              />
            </div>

            {item.options.length > 0 ? (
              <>
                <Divider className="my-space-md" />
                <ul className="flex flex-col gap-1.5">
                  {item.options.map((option) => (
                    <li
                      key={option.id}
                      className={cn(
                        'flex items-start gap-space-sm rounded px-space-sm py-1.5 font-body-sm text-body-sm',
                        option.isCorrect && 'bg-secondary-fixed/30 text-secondary',
                        !option.isCorrect && option.selected && 'bg-error-container/30 text-error',
                      )}
                    >
                      <MaterialIcon
                        name={option.isCorrect ? 'check' : option.selected ? 'close' : 'remove'}
                        className="mt-0.5 text-[14px]"
                      />
                      <span>
                        {option.label}
                        {option.selected ? <span className="ml-1 opacity-70">(your answer)</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {item.explanation ? (
              <>
                <Divider className="my-space-md" />
                <p className="flex items-start gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
                  <MaterialIcon name="lightbulb" className="mt-0.5 text-[14px]" />
                  {item.explanation}
                </p>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

