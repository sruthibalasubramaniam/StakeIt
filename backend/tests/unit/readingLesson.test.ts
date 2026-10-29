import { describe, expect, it } from 'vitest';
import {
  computeSectionUnlocks,
  evaluateReadingCompletion,
  gradeCheckpoint,
  validateCheckpointQuestions,
  type ReadingSectionShape,
} from '../../src/lib/reading';
import {
  countWords,
  estimateReadingMinutes,
  normalizeReferences,
  sanitizeReadingHtml,
  validateExternalUrl,
} from '../../src/lib/richText';

/**
 * The MOOC reader's rules.
 *
 * These are the assertions that matter for security and integrity: a learner
 * must not be able to skip a section, complete a checkpoint-guarded section
 * without passing it, or complete the lesson while anything is outstanding.
 * The same helpers run on the server for every mutation, so proving them here
 * proves the API's behaviour without a database.
 */

const sections: ReadingSectionShape[] = [
  { id: 's1', title: 'Why pairs trade', orderIndex: 0, hasCheckpoint: false },
  { id: 's2', title: 'Cointegration', orderIndex: 1, hasCheckpoint: true },
  { id: 's3', title: 'Execution', orderIndex: 2, hasCheckpoint: false },
];

describe('reading section unlocking', () => {
  it('opens only the first section on a fresh lesson', () => {
    const result = computeSectionUnlocks(sections, []);
    expect([...result.unlocked]).toEqual(['s1']);
    expect(result.firstIncompleteId).toBe('s1');
    expect(result.allComplete).toBe(false);
  });

  it('opens the next section as soon as the previous one completes', () => {
    const result = computeSectionUnlocks(sections, ['s1']);
    expect(result.unlocked.has('s1')).toBe(true);
    expect(result.unlocked.has('s2')).toBe(true);
    expect(result.unlocked.has('s3')).toBe(false);
    expect(result.firstIncompleteId).toBe('s2');
  });

  it('never unlocks past a gap, even when a later section is marked complete', () => {
    const result = computeSectionUnlocks(sections, ['s3']);
    expect(result.unlocked.has('s3')).toBe(false);
    expect(result.firstIncompleteId).toBe('s1');
  });

  it('reports completion only when every section is done', () => {
    expect(computeSectionUnlocks(sections, ['s1', 's2']).allComplete).toBe(false);
    const complete = computeSectionUnlocks(sections, ['s1', 's2', 's3']);
    expect(complete.allComplete).toBe(true);
    expect(complete.firstIncompleteId).toBeNull();
  });

  it('orders sections by orderIndex, not by array position', () => {
    const shuffled: ReadingSectionShape[] = [sections[2]!, sections[0]!, sections[1]!];
    const result = computeSectionUnlocks(shuffled, []);
    expect(result.orderedIds).toEqual(['s1', 's2', 's3']);
    expect([...result.unlocked]).toEqual(['s1']);
  });
});

describe('reading lesson completion', () => {
  it('does not treat a section-less lesson as complete', () => {
    const state = evaluateReadingCompletion([], []);
    expect(state.complete).toBe(false);
    expect(state.totalSections).toBe(0);
  });

  it('lists the outstanding sections so the API can explain the block', () => {
    const state = evaluateReadingCompletion(sections, ['s1']);
    expect(state.complete).toBe(false);
    expect(state.completedCount).toBe(1);
    expect(state.pendingSectionTitles).toEqual(['Cointegration', 'Execution']);
    expect(state.pendingCheckpoints).toBe(true);
    expect(state.percent).toBeCloseTo(33.3, 1);
  });

  it('completes only when every section is complete', () => {
    const state = evaluateReadingCompletion(sections, ['s1', 's2', 's3']);
    expect(state.complete).toBe(true);
    expect(state.percent).toBe(100);
  });
});

describe('checkpoint grading', () => {
  const questions = [
    {
      id: 'q1',
      type: 'SINGLE_CHOICE' as const,
      points: 1,
      options: [
        { id: 'q1a', isCorrect: true },
        { id: 'q1b', isCorrect: false },
      ],
    },
    {
      id: 'q2',
      type: 'MULTI_CHOICE' as const,
      points: 1,
      options: [
        { id: 'q2a', isCorrect: true },
        { id: 'q2b', isCorrect: true },
        { id: 'q2c', isCorrect: false },
      ],
    },
  ];

  it('passes only with every answer correct at the default 100% threshold', () => {
    const graded = gradeCheckpoint(questions, { q1: ['q1a'], q2: ['q2a', 'q2b'] }, 100);
    expect(graded.passed).toBe(true);
    expect(graded.percentage).toBe(100);
    expect(graded.correctCount).toBe(2);
  });

  it('fails a partially correct attempt and never leaks the answer key', () => {
    const graded = gradeCheckpoint(questions, { q1: ['q1a'], q2: ['q2a'] }, 100);
    expect(graded.passed).toBe(false);
    expect(graded.percentage).toBe(50);
    expect(graded.results.find((result) => result.questionId === 'q2')?.correctOptionIds).toEqual(['q2a', 'q2b']);
  });

  it('accepts multi-choice answers in any order', () => {
    const graded = gradeCheckpoint(questions, { q1: ['q1a'], q2: ['q2b', 'q2a'] }, 100);
    expect(graded.passed).toBe(true);
  });

  it('honours a lower configured passing score', () => {
    const graded = gradeCheckpoint(questions, { q1: ['q1a'], q2: ['q2c'] }, 50);
    expect(graded.percentage).toBe(50);
    expect(graded.passed).toBe(true);
  });

  it('treats missing answers as wrong rather than crashing', () => {
    const graded = gradeCheckpoint(questions, {}, 100);
    expect(graded.passed).toBe(false);
    expect(graded.percentage).toBe(0);
  });
});

describe('checkpoint authoring validation', () => {
  const limits = { maxQuestions: 10, maxOptions: 8 };

  it('accepts a well-formed checkpoint', () => {
    const issues = validateCheckpointQuestions(
      [
        {
          prompt: 'What does cointegration imply?',
          options: [
            { label: 'A stable long-run spread', isCorrect: true },
            { label: 'Zero correlation', isCorrect: false },
          ],
        },
      ],
      limits,
    );
    expect(issues).toEqual([]);
  });

  it('rejects a checkpoint with no correct option', () => {
    const issues = validateCheckpointQuestions(
      [{ prompt: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
      limits,
    );
    expect(issues.some((issue) => issue.includes('mark at least one option as correct'))).toBe(true);
  });

  it('rejects multiple correct options on a single-choice question', () => {
    const issues = validateCheckpointQuestions(
      [{ prompt: 'Pick one', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: true }] }],
      limits,
    );
    expect(issues.some((issue) => issue.includes('only have one correct option'))).toBe(true);
  });

  it('rejects unsupported question types', () => {
    const issues = validateCheckpointQuestions(
      [{ type: 'SUBJECTIVE', prompt: 'Explain', options: [{ label: 'A', isCorrect: true }, { label: 'B' }] }],
      limits,
    );
    expect(issues.some((issue) => issue.includes('single-choice, multi-choice and true/false'))).toBe(true);
  });

  it('rejects an empty question set', () => {
    expect(validateCheckpointQuestions([], limits)).toContain('A checkpoint needs at least one question.');
  });
});

describe('rich-text sanitisation', () => {
  it('keeps the allowed reading vocabulary', () => {
    const html = '<h2>Title</h2><p><strong>bold</strong><em>italic</em></p><ul><li>one</li></ul><pre><code>npm test</code></pre><table><tbody><tr><td>a</td></tr></tbody></table>';
    const clean = sanitizeReadingHtml(html);
    expect(clean).toContain('<h2>Title</h2>');
    expect(clean).toContain('<strong>bold</strong>');
    expect(clean).toContain('<ul><li>one</li></ul>');
    expect(clean).toContain('<pre><code>npm test</code></pre>');
    expect(clean).toContain('<table>');
  });

  it('removes executable markup entirely', () => {
    const clean = sanitizeReadingHtml('<p>safe</p><script>alert(1)</script><iframe src="https://evil.test"></iframe>');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('iframe');
    expect(clean).toContain('safe');
  });

  it('drops event handlers and inline styles', () => {
    const clean = sanitizeReadingHtml('<p style="color:red" onclick="steal()">text</p>');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('style=');
    expect(clean).toContain('text');
  });

  it('blocks javascript: and data: links', () => {
    expect(sanitizeReadingHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitizeReadingHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).not.toContain('data:');
  });

  it('adds rel=noopener to links and keeps https images', () => {
    const clean = sanitizeReadingHtml('<a href="https://example.com" target="_blank">x</a><img src="https://cdn.test/a.png" alt="a">');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('src="https://cdn.test/a.png"');
  });
});

describe('reading estimates and link validation', () => {
  it('counts words from HTML without tags', () => {
    expect(countWords('<p>one two <strong>three</strong></p>')).toBe(3);
  });

  it('estimates at least one minute for any non-empty section', () => {
    expect(estimateReadingMinutes('<p>tiny</p>')).toBe(1);
    expect(estimateReadingMinutes('<p>word </p>'.repeat(400))).toBeGreaterThanOrEqual(2);
    expect(estimateReadingMinutes('<p>anything</p>', 7)).toBe(7);
  });

  it('accepts https links and rejects dangerous schemes', () => {
    expect(validateExternalUrl('https://example.com/a.pdf').ok).toBe(true);
    expect(validateExternalUrl('http://example.com').ok).toBe(true);
    expect(validateExternalUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateExternalUrl('//example.com').ok).toBe(false);
    expect(validateExternalUrl('/relative').ok).toBe(false);
    expect(validateExternalUrl('').ok).toBe(false);
  });

  it('normalises references and reports invalid entries', () => {
    const result = normalizeReferences([
      { label: 'Paper', url: 'https://example.com/paper', note: 'optional' },
      { label: 'Bad', url: 'javascript:alert(1)' },
      { label: '' },
    ]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.label).toBe('Paper');
    expect(result.issues.length).toBe(2);
  });
});
