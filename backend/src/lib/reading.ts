/**
 * Structured reading-lesson rules.
 *
 * Everything here is pure so the MOOC reader's gates can be exhaustively unit
 * tested without a database:
 *
 *  - sections unlock strictly in order (section N needs N-1 completed),
 *  - a section is complete when its checkpoint is passed (or, when it has no
 *    checkpoint, when the learner explicitly marks it as read),
 *  - a lesson is complete only when *every* section is complete, which is what
 *    stops "scroll to the bottom" from counting as reading.
 *
 * The services call these helpers; the browser only renders their output, so a
 * crafted API call cannot unlock a section or complete a lesson early.
 */
import type { QuestionType } from '@prisma/client';
import { gradeQuestions, isPassing, normalizeAnswerMap, type AnswerMap, type GradeResult, type GradableQuestion } from './grading';

export interface ReadingSectionShape {
  id: string;
  title: string;
  orderIndex: number;
  /** Whether a checkpoint is attached (published checkpoint with questions). */
  hasCheckpoint: boolean;
}

export interface SectionUnlockResult {
  /** Ids the learner may open right now. */
  unlocked: Set<string>;
  /** First section that is not complete — where "Continue reading" points. */
  firstIncompleteId: string | null;
  /** Every section id, in reading order. */
  orderedIds: string[];
  /** True when every section is complete. */
  allComplete: boolean;
}

/**
 * Section-level sequential unlocking.
 *
 * Unlike course content, sections are never optional: a gap anywhere stops the
 * reader, because reading section 4 without section 3 is not a meaningful
 * shortcut — it is how a learner ends up skipping the material.
 */
export function computeSectionUnlocks(
  sections: ReadingSectionShape[],
  completedSectionIds: Iterable<string>,
): SectionUnlockResult {
  const ordered = [...sections].sort((a, b) => a.orderIndex - b.orderIndex);
  const completed = new Set(completedSectionIds);
  const unlocked = new Set<string>();
  const orderedIds: string[] = [];
  let blocked = false;
  let firstIncompleteId: string | null = null;

  for (const section of ordered) {
    orderedIds.push(section.id);
    if (blocked) continue;
    unlocked.add(section.id);
    if (!completed.has(section.id)) {
      if (firstIncompleteId === null) firstIncompleteId = section.id;
      blocked = true;
    }
  }

  return {
    unlocked,
    firstIncompleteId,
    orderedIds,
    allComplete: ordered.length > 0 && ordered.every((section) => completed.has(section.id)),
  };
}

export interface ReadingCompletionState {
  /** Whether the lesson satisfies its completion rule. */
  complete: boolean;
  completedCount: number;
  totalSections: number;
  percent: number;
  /** Titles of sections still outstanding (used in the 422 message). */
  pendingSectionTitles: string[];
  /** True when at least one pending section is guarded by a checkpoint. */
  pendingCheckpoints: boolean;
}

/**
 * Lesson completion rule for a structured reading.
 *
 * An empty section list is *not* complete: a structured lesson with no sections
 * is a draft, and a draft must never satisfy a completion requirement.
 */
export function evaluateReadingCompletion(
  sections: ReadingSectionShape[],
  completedSectionIds: Iterable<string>,
): ReadingCompletionState {
  const completed = new Set(completedSectionIds);
  const ordered = [...sections].sort((a, b) => a.orderIndex - b.orderIndex);
  const pending = ordered.filter((section) => !completed.has(section.id));
  const completedCount = ordered.length - pending.length;

  return {
    complete: ordered.length > 0 && pending.length === 0,
    completedCount,
    totalSections: ordered.length,
    percent: ordered.length === 0 ? 0 : Math.round((completedCount / ordered.length) * 1000) / 10,
    pendingSectionTitles: pending.map((section) => section.title),
    pendingCheckpoints: pending.some((section) => section.hasCheckpoint),
  };
}

export interface CheckpointGrade extends GradeResult {
  /** Whether the checkpoint's passing score was met. */
  passed: boolean;
  /** Normalised `{ questionId: [optionId] }` map that was graded. */
  answers: AnswerMap;
}

/**
 * Grades a checkpoint with the same engine as quizzes and assessments, so a
 * knowledge check behaves exactly like the rest of the platform (set equality
 * for multi-choice, no partial credit, answer keys never echoed for ungraded
 * types).
 */
export function gradeCheckpoint(
  questions: GradableQuestion[],
  answers: unknown,
  passingScore: number,
): CheckpointGrade {
  const normalized = normalizeAnswerMap(answers);
  const grade = gradeQuestions(questions, normalized);
  return { ...grade, passed: isPassing(grade, passingScore), answers: normalized };
}

/** Question types a checkpoint may use (auto-gradable knowledge checks only). */
export const CHECKPOINT_QUESTION_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'TRUE_FALSE'];

/**
 * Validates a checkpoint question set exactly the way `CurriculumService`
 * validates quiz questions, so authoring errors are reported consistently.
 */
export function validateCheckpointQuestions(
  questions: Array<{
    type?: QuestionType;
    prompt: string;
    points?: number;
    options?: Array<{ label: string; isCorrect?: boolean }>;
  }>,
  limits: { maxQuestions: number; maxOptions: number },
): string[] {
  const issues: string[] = [];

  if (questions.length === 0) issues.push('A checkpoint needs at least one question.');
  if (questions.length > limits.maxQuestions) {
    issues.push(`A checkpoint may contain at most ${limits.maxQuestions} questions.`);
  }

  questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    const type = question.type ?? 'SINGLE_CHOICE';

    if (!CHECKPOINT_QUESTION_TYPES.includes(type)) {
      issues.push(`${label}: only single-choice, multi-choice and true/false questions are supported.`);
      return;
    }
    if (!question.prompt?.trim()) issues.push(`${label}: add a prompt.`);

    const options = question.options ?? [];
    if (options.length < 2) {
      issues.push(`${label}: needs at least two options.`);
      return;
    }
    if (options.length > limits.maxOptions) {
      issues.push(`${label}: may have at most ${limits.maxOptions} options.`);
    }
    if (options.some((option) => !option.label?.trim())) {
      issues.push(`${label}: every option needs a label.`);
    }

    const correct = options.filter((option) => option.isCorrect);
    if (correct.length === 0) issues.push(`${label}: mark at least one option as correct.`);
    if (type !== 'MULTI_CHOICE' && correct.length > 1) {
      issues.push(`${label}: single-choice questions may only have one correct option.`);
    }
  });

  return issues;
}
