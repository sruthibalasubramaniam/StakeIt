/**
 * AI helpers for reading lessons.
 *
 * Two narrowly-scoped jobs, both grounded in text the learner or instructor can
 * already see:
 *
 *  1. `draftQuestions` — an instructor asks for knowledge-check drafts for one
 *     section. Drafts are returned to the editor and **never persisted here**:
 *     the instructor saves them through the normal checkpoint endpoint, so the
 *     existing review-and-publish gate is unchanged.
 *  2. `summariseSection` — a learner asks for a summary of the section they are
 *     currently on. Locked sections are refused, exactly like the reader.
 *
 * Everything degrades: no provider configured → `503 AI_UNAVAILABLE`, and the
 * product works without it.
 */
import { prisma } from '../lib/prisma';
import { AI_LIMITS } from '../config/constants';
import { ApiError, badRequest, forbidden, notFound, unprocessable } from '../lib/errors';
import { generateJson, generateText, isAiConfigured } from '../lib/ai';
import { htmlToPlainText } from '../lib/richText';
import { computeSectionUnlocks, type ReadingSectionShape } from '../lib/reading';
import { env } from '../config/env';

export interface DraftedOption {
  label: string;
  isCorrect: boolean;
}

export interface DraftedQuestion {
  prompt: string;
  explanation: string;
  options: DraftedOption[];
}

export interface SectionSummary {
  summary: string;
  keyPoints: string[];
}

const nonEmpty = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Validates generated questions before they ever reach the editor.
 *
 * Rejects: missing prompt, fewer than two options, duplicate labels, and any
 * item without exactly one correct option (the schema only supports
 * single-choice checkpoints today). Items are dropped rather than repaired — a
 * silently "fixed" question is worse than one fewer question.
 */
export function sanitiseDraftedQuestions(raw: unknown, maxQuestions: number): DraftedQuestion[] {
  const list = Array.isArray((raw as { questions?: unknown })?.questions)
    ? ((raw as { questions: unknown[] }).questions)
    : [];

  const clean: DraftedQuestion[] = [];

  for (const item of list) {
    if (clean.length >= maxQuestions) break;
    const candidate = item as { prompt?: unknown; explanation?: unknown; options?: unknown };
    const prompt = nonEmpty(candidate.prompt);
    const explanation = nonEmpty(candidate.explanation);
    const options = Array.isArray(candidate.options) ? candidate.options : [];

    const normalised: DraftedOption[] = options
      .map((option) => {
        const record = option as { label?: unknown; isCorrect?: unknown };
        return { label: nonEmpty(record.label), isCorrect: record.isCorrect === true };
      })
      .filter((option) => option.label.length > 0);

    const uniqueLabels = new Set(normalised.map((option) => option.label.toLowerCase()));
    const correct = normalised.filter((option) => option.isCorrect);

    if (prompt.length < 10) continue;
    if (normalised.length < 2 || normalised.length > 8) continue;
    if (uniqueLabels.size !== normalised.length) continue;
    if (correct.length !== 1) continue;

    clean.push({
      prompt,
      explanation: explanation || `The correct answer is “${correct[0]!.label}”.`,
      options: normalised,
    });
  }

  return clean;
}

export const AiReadingService = {
  status() {
    return {
      configured: isAiConfigured(),
      provider: env.AI_PROVIDER ?? null,
      model: env.AI_MODEL ?? null,
      purpose: 'Draft knowledge checks and summarise sections from their own text.',
    };
  },

  /**
   * Drafts knowledge-check questions for a section.
   *
   * Returned as data, not written to the database — the instructor reviews them
   * in the editor and saves through the existing checkpoint endpoint.
   */
  async draftQuestions(
    contentId: string,
    sectionId: string,
    actorId: string,
    role: string,
    count = 2,
  ) {
    if (!isAiConfigured()) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'AI features are not configured on this server.');
    }

    const section = await prisma.readingSection.findFirst({
      where: { id: sectionId, contentId },
      include: { content: { include: { module: { include: { course: true } } } } },
    });
    if (!section) throw notFound('Reading section');
    if (section.content.type !== 'READING') throw badRequest('This content is not a reading lesson.');
    if (role !== 'ADMIN' && section.content.module.course.instructorId !== actorId) {
      throw forbidden('You can only edit your own courses.');
    }

    const text = htmlToPlainText(section.bodyHtml).slice(0, AI_LIMITS.maxSourceChars);
    if (text.length < AI_LIMITS.minSourceChars) {
      throw unprocessable(
        'This section is too short to generate questions from. Write at least a couple of paragraphs first.',
        'VALIDATION_ERROR',
      );
    }

    const wanted = Math.min(Math.max(count, AI_LIMITS.minQuestions), AI_LIMITS.maxQuestions);

    const raw = await generateJson<{ questions: unknown }>([
      {
        role: 'system',
        content: [
          'You write knowledge checks for an online course reading section.',
          'Use ONLY the supplied section text. Do not use outside knowledge and do not invent facts.',
          'Each question must be answerable from a single sentence of the text.',
          'Return strict JSON: {"questions":[{"prompt":string,"explanation":string,"options":[{"label":string,"isCorrect":boolean}]}]}',
          'Rules: exactly 3 or 4 options per question, exactly one isCorrect true,',
          'the explanation must quote or paraphrase the supporting sentence in at most 25 words,',
          'no "all of the above", no negative wording.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Section title: ${section.title}`,
          `Produce ${wanted} questions.`,
          '--- SECTION TEXT ---',
          text,
        ].join('\n'),
      },
    ]);

    const questions = sanitiseDraftedQuestions(raw, wanted);
    if (questions.length === 0) {
      throw new ApiError(
        503,
        'AI_FAILED',
        'The AI provider did not return any usable questions. Try again, or write them manually.',
      );
    }

    return {
      sectionId,
      sectionTitle: section.title,
      source: 'AI_DRAFT' as const,
      questions,
    };
  },

  /**
   * Summarises a section for the learner currently reading it.
   *
   * Refuses locked sections so a summary can never leak content ahead of the
   * checkpoint that gates it.
   */
  async summariseSection(attemptId: string, contentId: string, sectionId: string, userId: string) {
    if (!isAiConfigured()) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'AI features are not configured on this server.');
    }

    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: {
        enrollment: { include: { course: { include: { modules: { include: { contents: true } } } } } },
      },
    });
    if (!attempt || attempt.enrollment.userId !== userId) throw forbidden('This attempt does not belong to you.');

    const content = attempt.enrollment.course.modules
      .flatMap((module) => module.contents)
      .find((item) => item.id === contentId);
    if (!content || content.type !== 'READING') throw notFound('Reading lesson');

    const sections = await prisma.readingSection.findMany({
      where: { contentId },
      orderBy: { orderIndex: 'asc' },
      include: { checkpoint: { select: { id: true } } },
    });
    const target = sections.find((section) => section.id === sectionId);
    if (!target) throw notFound('Reading section');

    const progress = await prisma.readingSectionProgress.findMany({
      where: { attemptId, contentId },
      select: { sectionId: true, isCompleted: true },
    });
    const shapes: ReadingSectionShape[] = sections.map((section) => ({
      id: section.id,
      title: section.title,
      orderIndex: section.orderIndex,
      hasCheckpoint: Boolean(section.checkpoint),
    }));
    const { unlocked } = computeSectionUnlocks(shapes, new Set(progress.filter((row) => row.isCompleted).map((row) => row.sectionId)));
    if (!unlocked.has(sectionId)) {
      throw new ApiError(403, 'CONTENT_LOCKED', 'This section unlocks after the previous knowledge check.');
    }

    const text = htmlToPlainText(target.bodyHtml).slice(0, AI_LIMITS.maxSourceChars);
    if (text.length < AI_LIMITS.minSourceChars) {
      throw unprocessable('This section is too short to summarise.', 'VALIDATION_ERROR');
    }

    const raw = await generateText([
      {
        role: 'system',
        content: [
          'You summarise a reading section for a learner.',
          'Use only the supplied text. Do not add facts, examples or advice that are not present.',
          'Answer in 3 short labelled parts: "Summary:" one sentence; "Key points:" 3 bullet lines starting with "- ";',
          'and "Watch for:" one sentence naming a common misconception in the text (or omit if none).',
        ].join(' '),
      },
      { role: 'user', content: `Section title: ${target.title}\n---\n${text}` },
    ]);

    const keyPoints = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean)
      .slice(0, 4);

    const summaryLine =
      raw
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^summary:/i.test(line))
        ?.replace(/^summary:\s*/i, '')
        .trim() ?? raw.split('\n')[0]!.trim();

    return {
      sectionId,
      summary: summaryLine,
      keyPoints,
      raw,
      source: 'AI' as const,
    };
  },
};
