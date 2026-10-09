/**
 * Deterministic auto-grading for objective question types.
 *
 * Design note: `CODING` and `SUBJECTIVE` items are intentionally *not*
 * auto-graded here. They are recorded as PENDING_REVIEW so a sandbox
 * evaluator (code execution against test cases) or an AI-rubric + human
 * reviewer can be plugged in later without changing the submission pipeline.
 * The whole module is pure, so the scoring arithmetic is unit tested.
 */
import type { QuestionType } from '@prisma/client';

export const AUTO_GRADABLE_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'TRUE_FALSE'];

export interface GradableOption {
  id: string;
  isCorrect: boolean;
}

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  points: number;
  options: GradableOption[];
}

/** `{ questionId: [optionId, ...] }` — a multi-choice answer is a set. */
export type AnswerMap = Record<string, string[]>;

export interface QuestionResult {
  questionId: string;
  type: QuestionType;
  awarded: number;
  maxPoints: number;
  correct: boolean;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  pendingReview: boolean;
}

export interface GradeResult {
  results: QuestionResult[];
  score: number;
  maxScore: number;
  percentage: number;
  correctCount: number;
  totalQuestions: number;
  /** True when at least one question needs human/AI review. */
  hasPendingReview: boolean;
  /** Points still in play from unanswered objective questions. */
  autoGradedScore: number;
  autoGradedMaxScore: number;
}

export function normalizeAnswerMap(raw: unknown): AnswerMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const result: AnswerMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => String(entry));
    } else if (value === null || value === undefined) {
      result[key] = [];
    } else {
      result[key] = [String(value)];
    }
  }
  return result;
}

/** Set equality — order and duplicates never matter. */
function sameSet(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const value of setA) if (!setB.has(value)) return false;
  return true;
}

/**
 * Grades a question set.
 *
 * - Single choice / true-false: exact single-option match.
 * - Multi choice: exact set match (all-or-nothing, no partial credit).
 * - Coding / subjective / short text: deferred to review (0 points awarded
 *   now, but the full points remain in `maxScore`).
 */
export function gradeQuestions(questions: GradableQuestion[], answers: AnswerMap): GradeResult {
  const results: QuestionResult[] = questions.map((question) => {
    const maxPoints = question.points ?? 1;
    const selected = answers[question.id] ?? [];
    const correctOptionIds = question.options.filter((option) => option.isCorrect).map((option) => option.id);

    if (!AUTO_GRADABLE_TYPES.includes(question.type)) {
      return {
        questionId: question.id,
        type: question.type,
        awarded: 0,
        maxPoints,
        correct: false,
        selectedOptionIds: selected,
        // Answer keys for subjective work are not exposed to the client.
        correctOptionIds: [],
        pendingReview: true,
      };
    }

    const correct = sameSet(selected, correctOptionIds);
    return {
      questionId: question.id,
      type: question.type,
      awarded: correct ? maxPoints : 0,
      maxPoints,
      correct,
      selectedOptionIds: selected,
      correctOptionIds,
      pendingReview: false,
    };
  });

  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  const score = results.reduce((sum, result) => sum + result.awarded, 0);
  const objectiveResults = results.filter((result) => !result.pendingReview);

  return {
    results,
    score,
    maxScore,
    percentage: maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0,
    correctCount: results.filter((result) => result.correct).length,
    totalQuestions: results.length,
    hasPendingReview: results.some((result) => result.pendingReview),
    autoGradedScore: objectiveResults.reduce((sum, result) => sum + result.awarded, 0),
    autoGradedMaxScore: objectiveResults.reduce((sum, result) => sum + result.maxPoints, 0),
  };
}

/**
 * A submission only "passes" when nothing is waiting on review, otherwise a
 * learner could clear a gate with an ungraded essay.
 */
export function isPassing(grade: GradeResult, passingScore: number): boolean {
  return !grade.hasPendingReview && grade.percentage >= passingScore;
}
