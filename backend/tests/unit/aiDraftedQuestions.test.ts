import { describe, expect, it } from 'vitest';
import { sanitiseDraftedQuestions } from '../../src/services/aiReadingService';

/**
 * Generated questions are the one place where a model's output would otherwise
 * reach a learner. These tests pin the filter that sits between the provider and
 * the instructor's editor: anything malformed is dropped, never repaired.
 */
describe('sanitiseDraftedQuestions', () => {
  const valid = {
    prompt: 'What does a discriminated union guarantee at compile time?',
    explanation: 'Every variant is handled, because the switch must be exhaustive.',
    options: [
      { label: 'That every variant is handled', isCorrect: true },
      { label: 'That the object is frozen', isCorrect: false },
      { label: 'That the type is erased', isCorrect: false },
    ],
  };

  it('keeps a well-formed single-choice question', () => {
    const result = sanitiseDraftedQuestions({ questions: [valid] }, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.options.filter((option) => option.isCorrect)).toHaveLength(1);
  });

  it('drops a question with two correct options', () => {
    const broken = { ...valid, options: valid.options.map((option) => ({ ...option, isCorrect: true })) };
    expect(sanitiseDraftedQuestions({ questions: [broken] }, 5)).toHaveLength(0);
  });

  it('drops a question with no correct option', () => {
    const broken = { ...valid, options: valid.options.map((option) => ({ ...option, isCorrect: false })) };
    expect(sanitiseDraftedQuestions({ questions: [broken] }, 5)).toHaveLength(0);
  });

  it('drops duplicate option labels', () => {
    const broken = {
      ...valid,
      options: [
        { label: 'Same', isCorrect: true },
        { label: 'same', isCorrect: false },
      ],
    };
    expect(sanitiseDraftedQuestions({ questions: [broken] }, 5)).toHaveLength(0);
  });

  it('drops a question with fewer than two options', () => {
    const broken = { ...valid, options: [{ label: 'Only one', isCorrect: true }] };
    expect(sanitiseDraftedQuestions({ questions: [broken] }, 5)).toHaveLength(0);
  });

  it('drops a prompt that is too short to be a question', () => {
    const broken = { ...valid, prompt: 'Why?' };
    expect(sanitiseDraftedQuestions({ questions: [broken] }, 5)).toHaveLength(0);
  });

  it('respects the requested count', () => {
    const result = sanitiseDraftedQuestions({ questions: [valid, valid, valid] }, 2);
    expect(result).toHaveLength(2);
  });

  it('returns an empty array for a malformed payload', () => {
    expect(sanitiseDraftedQuestions(null, 5)).toHaveLength(0);
    expect(sanitiseDraftedQuestions({ questions: 'nope' }, 5)).toHaveLength(0);
    expect(sanitiseDraftedQuestions({}, 5)).toHaveLength(0);
  });

  it('backfills an explanation when the model omits one', () => {
    const { explanation: _ignored, ...withoutExplanation } = valid;
    const result = sanitiseDraftedQuestions({ questions: [withoutExplanation] }, 5);
    expect(result[0]!.explanation).toContain('That every variant is handled');
  });
});
