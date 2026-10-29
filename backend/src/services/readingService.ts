/**
 * Structured reading lessons — authoring + learner payload.
 *
 * This service owns the *shape* of a MOOC reading lesson: sanitised sections,
 * checkpoints, attached resources, publication gate and the payload the reader
 * renders. Learner progression (position, section completion, checkpoint
 * attempts) lives in `readingProgressService`, which sits on top of the existing
 * attempt guards so nothing here can bypass sequential unlocking.
 *
 * Design constraints, deliberately chosen to protect the existing platform:
 *  - `ModuleContent` (the existing lesson row) stays the unit of course
 *    progression; sections are additive children.
 *  - Lessons written before this feature have no sections. They keep working
 *    unchanged (plain `readingBody`), and are treated as published.
 *  - Completion is only ever granted by `LearningService.completeContent`.
 */
import type { ContentType, ModuleContent, Prisma, QuestionType } from '@prisma/client';
import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { READING_LIMITS } from '../config/constants';
import {
  CHECKPOINT_QUESTION_TYPES,
  computeSectionUnlocks,
  evaluateReadingCompletion,
  validateCheckpointQuestions,
  type ReadingSectionShape,
} from '../lib/reading';
import {
  estimateReadingMinutes,
  normalizeReferences,
  sanitizeReadingHtml,
  validateExternalUrl,
  type ReadingReference,
} from '../lib/richText';
import { buildReadingAssetPath, createSignedUrl, deleteObject, isStorageConfigured, uploadObject, validatePdfUpload } from '../lib/storage';
import { isAiConfigured } from '../lib/ai';
import { CourseService } from './courseService';
import { roundTo } from '../utils/date';

/* -------------------------------------------------------------------------- */
/* Shared types                                                                */
/* -------------------------------------------------------------------------- */

export interface LessonMetaInput {
  description?: string | null;
  estimatedMinutes?: number | null;
  objectives?: string[];
  references?: unknown;
}

export interface SectionInput {
  title: string;
  bodyHtml: string;
  estimatedMinutes?: number | null;
}

export interface CheckpointQuestionInput {
  type?: QuestionType;
  prompt: string;
  explanation?: string | null;
  points?: number;
  options: Array<{ label: string; isCorrect?: boolean }>;
}

export interface CheckpointInput {
  title: string;
  prompt?: string | null;
  passingScore?: number;
  maxAttempts?: number | null;
  questions: CheckpointQuestionInput[];
}

const sectionInclude = {
  checkpoint: {
    include: {
      questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
    },
  },
} satisfies Prisma.ReadingSectionInclude;

type SectionWithCheckpoint = Prisma.ReadingSectionGetPayload<{ include: typeof sectionInclude }>;

export interface LessonRecord {
  content: ModuleContent;
  courseId: string;
  sections: SectionWithCheckpoint[];
  resources: Array<Prisma.ReadingResourceGetPayload<Record<string, never>>>;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function assertReadingContent(content: Pick<ModuleContent, 'type'>): void {
  if (content.type !== 'READING') {
    throw badRequest('Only reading lessons can be authored here.', { type: content.type });
  }
}

function toSectionShape(section: SectionWithCheckpoint): ReadingSectionShape {
  return {
    id: section.id,
    title: section.title,
    orderIndex: section.orderIndex,
    hasCheckpoint: Boolean(section.checkpoint && section.checkpoint.questions.length > 0),
  };
}

/**
 * A structured lesson becomes readable only once published. Legacy readings
 * (no sections) predate the gate and stay readable, so existing courses are
 * unaffected.
 */
export function isLessonPublished(params: { hasSections: boolean; readingPublishedAt: Date | null }): boolean {
  if (!params.hasSections) return true;
  return params.readingPublishedAt !== null;
}

/** Question types a checkpoint may use — knowledge checks only. */
export function coerceCheckpointType(type: QuestionType | undefined): QuestionType {
  const resolved = type ?? 'SINGLE_CHOICE';
  if (!CHECKPOINT_QUESTION_TYPES.includes(resolved)) {
    throw badRequest('Checkpoints support single-choice, multi-choice and true/false questions only.', { type: resolved });
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Authoring                                                                   */
/* -------------------------------------------------------------------------- */

export const ReadingService = {
  async loadForAuthoring(contentId: string, actorId: string, role: string): Promise<LessonRecord> {
    const content = await prisma.moduleContent.findUnique({
      where: { id: contentId },
      include: { module: { include: { course: true } } },
    });
    if (!content) throw notFound('Content');
    await CourseService.assertInstructorOwnsCourse(content.module.courseId, actorId, role);
    assertReadingContent(content);

    const [sections, resources] = await Promise.all([
      prisma.readingSection.findMany({
        where: { contentId },
        orderBy: { orderIndex: 'asc' },
        include: sectionInclude,
      }),
      prisma.readingResource.findMany({ where: { contentId }, orderBy: { orderIndex: 'asc' } }),
    ]);

    return { content, courseId: content.module.courseId, sections, resources };
  },

  /** Full draft view for the instructor editor (answer keys included). */
  async authoringView(contentId: string, actorId: string, role: string) {
    const { content, sections, resources } = await this.loadForAuthoring(contentId, actorId, role);

    return {
      content: {
        id: content.id,
        moduleId: content.moduleId,
        title: content.title,
        description: content.description,
        type: content.type,
        isRequired: content.isRequired,
        estimatedMinutes: content.estimatedMinutes,
        objectives: content.readingObjectives,
        references: (content.readingReferences as ReadingReference[] | null) ?? [],
        readingBody: content.readingBody,
        requiresComprehensionCheck: content.requiresComprehensionCheck,
        comprehensionPrompt: content.comprehensionPrompt,
        published: content.readingPublishedAt !== null,
        publishedAt: content.readingPublishedAt,
        version: content.readingVersion,
        structured: sections.length > 0,
      },
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        bodyHtml: section.bodyHtml,
        orderIndex: section.orderIndex,
        estimatedMinutes: section.estimatedMinutes,
        wordCount: section.bodyHtml ? section.bodyHtml.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length : 0,
        checkpoint: section.checkpoint
          ? {
              id: section.checkpoint.id,
              title: section.checkpoint.title,
              prompt: section.checkpoint.prompt,
              passingScore: section.checkpoint.passingScore,
              maxAttempts: section.checkpoint.maxAttempts,
              questions: section.checkpoint.questions.map((question) => ({
                id: question.id,
                type: question.type,
                prompt: question.prompt,
                explanation: question.explanation,
                points: question.points,
                orderIndex: question.orderIndex,
                options: question.options.map((option) => ({
                  id: option.id,
                  label: option.label,
                  isCorrect: option.isCorrect,
                  orderIndex: option.orderIndex,
                })),
              })),
            }
          : null,
      })),
      resources: resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        title: resource.title,
        url: resource.url,
        fileName: resource.fileName,
        mimeType: resource.mimeType,
        sizeBytes: resource.sizeBytes,
        orderIndex: resource.orderIndex,
        isDownloadable: resource.isDownloadable,
      })),
      estimatedReadingMinutes: sections.reduce(
        (sum, section) => sum + estimateReadingMinutes(section.bodyHtml, section.estimatedMinutes),
        0,
      ),
      storageConfigured: isStorageConfigured(),
      /** Drives the "draft with AI" affordance — hidden when no provider is set. */
      aiConfigured: isAiConfigured(),
      limits: READING_LIMITS,
    };
  },

  /** Updates the lesson-level metadata (description, objectives, references). */
  async updateLesson(contentId: string, actorId: string, role: string, input: LessonMetaInput) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);

    if (input.description !== undefined && input.description !== null && input.description.length > 2000) {
      throw badRequest('The lesson description is too long (2000 characters maximum).');
    }
    if (input.estimatedMinutes !== undefined && input.estimatedMinutes !== null) {
      if (!Number.isFinite(input.estimatedMinutes) || input.estimatedMinutes < 0 || input.estimatedMinutes > 6000) {
        throw badRequest('Estimated minutes must be between 0 and 6000.');
      }
    }

    const { references, issues } = normalizeReferences(input.references);
    if (issues.length > 0) {
      throw unprocessable('Some references are invalid.', 'VALIDATION_ERROR', { issues });
    }

    const objectives = (input.objectives ?? content.readingObjectives)
      .map((objective) => objective.trim())
      .filter(Boolean)
      .slice(0, 12);

    const updated = await prisma.moduleContent.update({
      where: { id: contentId },
      data: {
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
        ...(input.objectives !== undefined ? { readingObjectives: objectives } : {}),
        ...(input.references !== undefined
          ? { readingReferences: references as unknown as Prisma.InputJsonValue }
          : {}),
        readingVersion: content.readingVersion + 1,
      },
    });

    return {
      id: updated.id,
      description: updated.description,
      estimatedMinutes: updated.estimatedMinutes,
      objectives: updated.readingObjectives,
      references: updated.readingReferences as unknown as ReadingReference[],
      version: updated.readingVersion,
    };
  },

  /* ----------------------------- Sections -------------------------------- */

  async createSection(contentId: string, actorId: string, role: string, input: SectionInput) {
    const { content, sections } = await this.loadForAuthoring(contentId, actorId, role);

    if (sections.length >= READING_LIMITS.maxSections) {
      throw unprocessable(`A lesson may contain at most ${READING_LIMITS.maxSections} sections.`, 'VALIDATION_ERROR');
    }
    const title = input.title?.trim();
    if (!title) throw badRequest('Every section needs a title.');
    if (title.length > 200) throw badRequest('Section titles are limited to 200 characters.');

    const bodyHtml = sanitizeReadingHtml(input.bodyHtml);
    if (bodyHtml.length > READING_LIMITS.maxSectionChars) {
      throw badRequest(`Section content is limited to ${READING_LIMITS.maxSectionChars} characters.`);
    }

    return withTransaction(async (tx) => {
      const section = await tx.readingSection.create({
        data: {
          contentId,
          title,
          bodyHtml,
          orderIndex: sections.length,
          estimatedMinutes: input.estimatedMinutes ?? null,
        },
        include: sectionInclude,
      });
      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });
      return section;
    });
  },

  async updateSection(contentId: string, sectionId: string, actorId: string, role: string, input: Partial<SectionInput>) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);

    const section = await prisma.readingSection.findFirst({ where: { id: sectionId, contentId } });
    if (!section) throw notFound('Section');

    const bodyHtml = input.bodyHtml === undefined ? undefined : sanitizeReadingHtml(input.bodyHtml);
    if (bodyHtml !== undefined && bodyHtml.length > READING_LIMITS.maxSectionChars) {
      throw badRequest(`Section content is limited to ${READING_LIMITS.maxSectionChars} characters.`);
    }
    if (input.title !== undefined && (!input.title.trim() || input.title.length > 200)) {
      throw badRequest('Section titles must be between 1 and 200 characters.');
    }

    return withTransaction(async (tx) => {
      const updated = await tx.readingSection.update({
        where: { id: sectionId },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(bodyHtml !== undefined ? { bodyHtml } : {}),
          ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
        },
        include: sectionInclude,
      });
      // Learners who already completed this section keep their completion:
      // editing published content never deletes progress rows.
      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });
      return updated;
    });
  },

  async deleteSection(contentId: string, sectionId: string, actorId: string, role: string) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);

    const section = await prisma.readingSection.findFirst({ where: { id: sectionId, contentId } });
    if (!section) throw notFound('Section');

    const learnerRecords = await prisma.readingSectionProgress.count({ where: { sectionId } });
    if (learnerRecords > 0 && content.readingPublishedAt !== null) {
      throw conflict(
        'This section has learner progress recorded. Unpublish the lesson (or archive the section content) instead of deleting it.',
      );
    }

    await withTransaction(async (tx) => {
      await tx.readingSection.delete({ where: { id: sectionId } });
      const remaining = await tx.readingSection.findMany({
        where: { contentId },
        orderBy: { orderIndex: 'asc' },
        select: { id: true },
      });
      for (const [index, entry] of remaining.entries()) {
        await tx.readingSection.update({ where: { id: entry.id }, data: { orderIndex: index } });
      }
      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });
    });

    return { id: sectionId, deleted: true };
  },

  /** `orderedIds` must be a permutation of the lesson's sections. */
  async reorderSections(contentId: string, actorId: string, role: string, orderedIds: string[]) {
    const { content, sections } = await this.loadForAuthoring(contentId, actorId, role);

    const existing = new Set(sections.map((section) => section.id));
    if (orderedIds.length !== sections.length || orderedIds.some((id) => !existing.has(id))) {
      throw badRequest('The reorder payload must contain every section of this lesson exactly once.', {
        expected: sections.length,
        received: orderedIds.length,
      });
    }

    await withTransaction(async (tx) => {
      // Two passes: a unique-free index column means a single pass is fine, but
      // writing -1 offsets first keeps the intent explicit and avoids any
      // future unique constraint surprise.
      for (const [index, id] of orderedIds.entries()) {
        await tx.readingSection.update({ where: { id }, data: { orderIndex: index } });
      }
      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });
    });

    return prisma.readingSection.findMany({ where: { contentId }, orderBy: { orderIndex: 'asc' }, include: sectionInclude });
  },

  /* ---------------------------- Checkpoints ------------------------------- */

  async upsertCheckpoint(contentId: string, sectionId: string, actorId: string, role: string, input: CheckpointInput) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);

    const section = await prisma.readingSection.findFirst({ where: { id: sectionId, contentId } });
    if (!section) throw notFound('Section');

    const title = input.title?.trim() || `Knowledge check · ${section.title}`;
    if (title.length > 200) throw badRequest('Checkpoint titles are limited to 200 characters.');
    if (input.prompt !== undefined && input.prompt !== null && input.prompt.length > 1000) {
      throw badRequest('Checkpoint prompts are limited to 1000 characters.');
    }

    const passingScore = input.passingScore ?? 100;
    if (!Number.isInteger(passingScore) || passingScore < 0 || passingScore > 100) {
      throw badRequest('The passing score must be an integer between 0 and 100.');
    }
    if (input.maxAttempts !== undefined && input.maxAttempts !== null && input.maxAttempts < 1) {
      throw badRequest('Max attempts must be at least 1, or empty for unlimited.');
    }

    const questions = input.questions ?? [];
    const issues = validateCheckpointQuestions(questions, {
      maxQuestions: READING_LIMITS.maxQuestionsPerCheckpoint,
      maxOptions: READING_LIMITS.maxOptionsPerQuestion,
    });
    if (issues.length > 0) {
      throw unprocessable('The checkpoint is not valid yet.', 'VALIDATION_ERROR', { issues });
    }

    return withTransaction(async (tx) => {
      const existing = await tx.readingCheckpoint.findUnique({ where: { sectionId } });

      const checkpoint = existing
        ? await tx.readingCheckpoint.update({
            where: { id: existing.id },
            data: {
              title,
              prompt: input.prompt?.trim() || null,
              passingScore,
              maxAttempts: input.maxAttempts ?? null,
            },
          })
        : await tx.readingCheckpoint.create({
            data: {
              contentId,
              sectionId,
              title,
              prompt: input.prompt?.trim() || null,
              passingScore,
              maxAttempts: input.maxAttempts ?? null,
            },
          });

      // Replacing the question set is atomic, exactly like quizzes: the old
      // questions (and their options) are removed in the same transaction.
      await tx.readingCheckpointQuestion.deleteMany({ where: { checkpointId: checkpoint.id } });
      for (const [index, question] of questions.entries()) {
        await tx.readingCheckpointQuestion.create({
          data: {
            checkpointId: checkpoint.id,
            type: coerceCheckpointType(question.type),
            prompt: question.prompt.trim(),
            explanation: question.explanation?.trim() || null,
            points: question.points ?? 1,
            orderIndex: index,
            options: {
              create: question.options.map((option, optionIndex) => ({
                label: option.label.trim(),
                isCorrect: option.isCorrect ?? false,
                orderIndex: optionIndex,
              })),
            },
          },
        });
      }

      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });

      return tx.readingCheckpoint.findUniqueOrThrow({
        where: { id: checkpoint.id },
        include: {
          questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
        },
      });
    });
  },

  async deleteCheckpoint(contentId: string, sectionId: string, actorId: string, role: string) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);

    const checkpoint = await prisma.readingCheckpoint.findFirst({ where: { sectionId, contentId } });
    if (!checkpoint) throw notFound('Checkpoint');

    await withTransaction(async (tx) => {
      await tx.readingCheckpoint.delete({ where: { id: checkpoint.id } });
      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });
    });

    return { id: checkpoint.id, deleted: true };
  },

  /* --------------------------- Publication -------------------------------- */

  /**
   * Publication gate. Mirrors the course publish checklist: a lesson cannot go
   * live with empty sections or a checkpoint that cannot be answered.
   */
  async validateLesson(contentId: string): Promise<{ issues: string[] }> {
    const content = await prisma.moduleContent.findUnique({
      where: { id: contentId },
      include: {
        readingSections: {
          orderBy: { orderIndex: 'asc' },
          include: { checkpoint: { include: { questions: { include: { options: true } } } } },
        },
        readingResources: true,
      },
    });
    if (!content) throw notFound('Content');

    const issues: string[] = [];

    if (!content.readingObjectives.every((objective) => objective.length <= 300)) {
      issues.push('Each learning objective must be 300 characters or fewer.');
    }

    const references = (content.readingReferences as ReadingReference[] | null) ?? [];
    for (const reference of references) {
      const check = validateExternalUrl(reference.url);
      if (!check.ok) issues.push(`Reference "${reference.label}": ${check.reason}`);
    }

    if (content.readingSections.length === 0) {
      if (!content.readingBody?.trim()) {
        issues.push('Add at least one section (or a plain reading body) before publishing this lesson.');
      }
    } else {
      content.readingSections.forEach((section, index) => {
        if (!section.title.trim()) issues.push(`Section ${index + 1} has no title.`);
        const hasText = section.bodyHtml.replace(/<[^>]*>/g, '').trim().length > 0 || /<img|<table|<pre/i.test(section.bodyHtml);
        if (!hasText) issues.push(`Section "${section.title || index + 1}" is empty.`);

        if (section.checkpoint) {
          if (section.checkpoint.questions.length === 0) {
            issues.push(`The checkpoint in "${section.title}" has no questions.`);
          }
          section.checkpoint.questions.forEach((question, questionIndex) => {
            const correct = question.options.filter((option) => option.isCorrect).length;
            if (correct === 0 || (question.type !== 'MULTI_CHOICE' && correct > 1)) {
              issues.push(
                `Checkpoint question ${questionIndex + 1} in "${section.title}" needs a valid correct option set.`,
              );
            }
          });
        }
      });
    }

    content.readingResources.forEach((resource) => {
      if (resource.kind === 'PDF' && !resource.storagePath) {
        issues.push(`The PDF "${resource.title}" has no stored file.`);
      }
      if (resource.kind !== 'PDF' && !resource.url) {
        issues.push(`The resource "${resource.title}" has no URL.`);
      }
      if (resource.url) {
        const check = validateExternalUrl(resource.url);
        if (!check.ok) issues.push(`The resource "${resource.title}": ${check.reason}`);
      }
    });

    return { issues };
  },

  async publish(contentId: string, actorId: string, role: string) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);
    const { issues } = await this.validateLesson(contentId);
    if (issues.length > 0) {
      throw unprocessable('This reading lesson is not ready to publish.', 'INVALID_COURSE_CONFIGURATION', { issues });
    }

    const updated = await prisma.moduleContent.update({
      where: { id: contentId },
      data: { readingPublishedAt: content.readingPublishedAt ?? new Date() },
    });

    return { id: updated.id, published: true, publishedAt: updated.readingPublishedAt, version: updated.readingVersion };
  },

  async unpublish(contentId: string, actorId: string, role: string) {
    await this.loadForAuthoring(contentId, actorId, role);
    const updated = await prisma.moduleContent.update({ where: { id: contentId }, data: { readingPublishedAt: null } });
    return { id: updated.id, published: false, publishedAt: null };
  },

  /**
   * Instructor preview. Every section is visible (so a draft can be reviewed
   * end-to-end), no learner progress is read, and answer keys stay hidden.
   */
  async preview(contentId: string, actorId: string, role: string) {
    const { content } = await this.loadForAuthoring(contentId, actorId, role);
    const payload = await this.buildReaderPayload({ content, userId: actorId, preview: true });
    const { issues } = await this.validateLesson(contentId);
    return { ...payload, preview: true, publishIssues: issues };
  },

  /* ---------------------------- Resources --------------------------------- */

  async addLinkResource(
    contentId: string,
    actorId: string,
    role: string,
    input: { kind: 'EXTERNAL_LINK' | 'EMBED'; title: string; url: string; isDownloadable?: boolean },
  ) {
    const { resources } = await this.loadForAuthoring(contentId, actorId, role);

    if (resources.length >= READING_LIMITS.maxResources) {
      throw unprocessable(`A lesson may attach at most ${READING_LIMITS.maxResources} resources.`, 'VALIDATION_ERROR');
    }
    const title = input.title?.trim();
    if (!title) throw badRequest('Give the resource a title.');
    if (title.length > 200) throw badRequest('Resource titles are limited to 200 characters.');

    const validated = validateExternalUrl(input.url);
    if (!validated.ok) throw badRequest(`That link cannot be attached: ${validated.reason}`, { url: input.url });

    return prisma.readingResource.create({
      data: {
        contentId,
        kind: input.kind,
        title,
        url: validated.url,
        orderIndex: resources.length,
        isDownloadable: input.isDownloadable ?? false,
      },
    });
  },

  async uploadPdfResource(
    contentId: string,
    actorId: string,
    role: string,
    upload: { body: Buffer | undefined; contentType: string | undefined; fileName: string | undefined; title?: string },
  ) {
    const { content, courseId, resources } = await this.loadForAuthoring(contentId, actorId, role);

    if (resources.length >= READING_LIMITS.maxResources) {
      throw unprocessable(`A lesson may attach at most ${READING_LIMITS.maxResources} resources.`, 'VALIDATION_ERROR');
    }

    // Validated before a single byte reaches storage.
    const pdf = validatePdfUpload(upload.body, upload.contentType, upload.fileName);

    const objectPath = buildReadingAssetPath({ courseId, contentId });
    await uploadObject({ objectPath, body: pdf.buffer, contentType: pdf.mimeType });

    try {
      const created = await prisma.readingResource.create({
        data: {
          contentId,
          kind: 'PDF',
          title: upload.title?.trim() || pdf.fileName.replace(/\.pdf$/i, ''),
          storagePath: objectPath,
          fileName: pdf.fileName,
          mimeType: pdf.mimeType,
          sizeBytes: pdf.buffer.length,
          orderIndex: resources.length,
          isDownloadable: true,
        },
      });

      await prisma.moduleContent.update({
        where: { id: contentId },
        data: { readingVersion: content.readingVersion + 1 },
      });

      return created;
    } catch (error) {
      // Metadata failed after the upload: drop the orphan object so storage does
      // not accumulate unreachable files.
      await deleteObject(objectPath);
      throw error;
    }
  },

  async deleteResource(contentId: string, resourceId: string, actorId: string, role: string) {
    await this.loadForAuthoring(contentId, actorId, role);

    const resource = await prisma.readingResource.findFirst({ where: { id: resourceId, contentId } });
    if (!resource) throw notFound('Resource');

    await prisma.readingResource.delete({ where: { id: resourceId } });
    if (resource.storagePath) await deleteObject(resource.storagePath);

    return { id: resourceId, deleted: true };
  },

  /** Signed URL for an instructor previewing their own uploaded PDF. */
  async resourceUrlForAuthoring(contentId: string, resourceId: string, actorId: string, role: string) {
    await this.loadForAuthoring(contentId, actorId, role);
    const resource = await prisma.readingResource.findFirst({ where: { id: resourceId, contentId } });
    if (!resource) throw notFound('Resource');
    return this.describeResourceUrl(resource);
  },

  /** Resolves a resource to something the browser can open. */
  async describeResourceUrl(resource: {
    id: string;
    kind: string;
    url: string | null;
    storagePath: string | null;
    isDownloadable: boolean;
  }) {
    if (resource.kind !== 'PDF') {
      return { id: resource.id, url: resource.url, available: Boolean(resource.url), expiresIn: null as number | null };
    }
    if (!resource.storagePath) {
      return { id: resource.id, url: null, available: false, expiresIn: null as number | null };
    }
    if (!isStorageConfigured()) {
      return { id: resource.id, url: null, available: false, expiresIn: null as number | null };
    }

    try {
      const url = await createSignedUrl(resource.storagePath);
      return { id: resource.id, url, available: true, expiresIn: null as number | null };
    } catch {
      // A signing failure must not fail the whole lesson payload.
      return { id: resource.id, url: null, available: false, expiresIn: null as number | null };
    }
  },

  /* --------------------------- Course-level gate -------------------------- */

  /** Blocking items contributed by reading lessons to `CourseService.publish`. */
  async coursePublishBlockers(courseId: string) {
    const readings = await prisma.moduleContent.findMany({
      where: { type: 'READING', module: { courseId } },
      select: { id: true, title: true, readingPublishedAt: true, _count: { select: { readingSections: true } } },
    });

    const blockers: Array<{ field: string; message: string }> = [];
    for (const reading of readings) {
      const isStructured = reading._count.readingSections > 0;
      if (isStructured && reading.readingPublishedAt === null) {
        blockers.push({
          field: `content:${reading.id}`,
          message: `Reading lesson "${reading.title}" is still a draft — publish it before publishing the course.`,
        });
        continue;
      }
      const { issues } = await this.validateLesson(reading.id);
      for (const issue of issues) {
        blockers.push({ field: `content:${reading.id}`, message: `Reading "${reading.title}": ${issue}` });
      }
    }

    return blockers;
  },

  /* ---------------------------- Learner payload --------------------------- */

  /**
   * Builds the reader payload for an already-authorised attempt.
   *
   * The caller (`LearningService`) has verified ownership, attempt state and the
   * course-level lock. This method only shapes data: it never grants access on
   * its own, and it strips every answer key.
   */
  async buildReaderPayload(params: {
    attemptId?: string;
    content: ModuleContent;
    userId: string;
    /** Instructor preview: every section visible, no learner progress applied. */
    preview?: boolean;
  }) {
    const { content, userId, preview = false } = params;
    const attemptId = params.attemptId ?? '';

    const [sections, resources] = await Promise.all([
      prisma.readingSection.findMany({
        where: { contentId: content.id },
        orderBy: { orderIndex: 'asc' },
        include: sectionInclude,
      }),
      prisma.readingResource.findMany({ where: { contentId: content.id }, orderBy: { orderIndex: 'asc' } }),
    ]);

    const learnerScoped = !preview && attemptId.length > 0;
    const [progress, sectionProgress] = learnerScoped
      ? await Promise.all([
          prisma.contentProgress.findUnique({ where: { attemptId_contentId: { attemptId, contentId: content.id } } }),
          prisma.readingSectionProgress.findMany({ where: { attemptId, contentId: content.id } }),
        ])
      : [null, []];

    const rows: typeof sectionProgress = sectionProgress;
    const completedIds = new Set(rows.filter((row) => row.isCompleted).map((row) => row.sectionId));
    const progressBySection = new Map(rows.map((row) => [row.sectionId, row]));
    const shapes = sections.map(toSectionShape);
    const completion = evaluateReadingCompletion(shapes, completedIds);
    // Same walk as the mutation guard, so the UI and the API can never disagree.
    const unlockedIds = preview
      ? new Set(sections.map((section) => section.id))
      : computeSectionUnlocks(shapes, completedIds).unlocked;

    const resolvedResources = await Promise.all(
      resources.map(async (resource) => {
        const resolved = await this.describeResourceUrl(resource);
        return {
          id: resource.id,
          kind: resource.kind,
          title: resource.title,
          url: resolved.url,
          available: resolved.available,
          fileName: resource.fileName,
          mimeType: resource.mimeType,
          sizeBytes: resource.sizeBytes,
          isDownloadable: resource.isDownloadable,
        };
      }),
    );

    const totalMinutes =
      sections.reduce((sum, section) => sum + estimateReadingMinutes(section.bodyHtml, section.estimatedMinutes), 0) +
      (sections.length === 0 ? estimateReadingMinutes(content.readingBody, content.estimatedMinutes) : 0);

    const resumeSectionId =
      progress?.lastSectionId && sections.some((section) => section.id === progress.lastSectionId)
        ? progress.lastSectionId
        : (shapes.find((section) => !completedIds.has(section.id)) ?? shapes[0])?.id ?? null;

    return {
      structured: sections.length > 0,
      body: sections.length === 0 ? content.readingBody : null,
      objectives: content.readingObjectives,
      references: (content.readingReferences as ReadingReference[] | null) ?? [],
      estimatedMinutes: totalMinutes,
      version: content.readingVersion,
      published: isLessonPublished({ hasSections: sections.length > 0, readingPublishedAt: content.readingPublishedAt }),
      sections: sections.map((section) => {
        const row = progressBySection.get(section.id);
        const isUnlocked = unlockedIds.has(section.id);
        const isCompleted = completedIds.has(section.id);
        const checkpoint = section.checkpoint;

        return {
          id: section.id,
          title: section.title,
          orderIndex: section.orderIndex,
          estimatedMinutes: estimateReadingMinutes(section.bodyHtml, section.estimatedMinutes),
          wordCount: section.bodyHtml.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length,
          bodyHtml: isUnlocked ? section.bodyHtml : null,
          isUnlocked,
          isCompleted,
          lockReason: isUnlocked ? null : 'Complete the previous section to unlock this one.',
          checkpoint: checkpoint
            ? {
                id: checkpoint.id,
                title: checkpoint.title,
                prompt: checkpoint.prompt,
                passingScore: checkpoint.passingScore,
                maxAttempts: checkpoint.maxAttempts,
                attemptsUsed: row?.checkpointAttempts ?? 0,
                passed: row?.checkpointPassed ?? null,
                // Answer keys are only revealed once the checkpoint is cleared.
                questions: checkpoint.questions.map((question) => ({
                  id: question.id,
                  type: question.type,
                  prompt: question.prompt,
                  points: question.points,
                  orderIndex: question.orderIndex,
                  explanation: row?.checkpointPassed ? question.explanation : null,
                  options: question.options.map((option) => ({
                    id: option.id,
                    label: option.label,
                    orderIndex: option.orderIndex,
                    ...(row?.checkpointPassed ? { isCorrect: option.isCorrect } : {}),
                  })),
                })),
              }
            : null,
        };
      }),
      resources: resolvedResources,
      resume: {
        sectionId: resumeSectionId,
        sectionIndex: Math.max(0, shapes.findIndex((section) => section.id === resumeSectionId)),
        pdfPage: progress?.lastPdfPage ?? null,
      },
      sectionProgress: {
        completed: completion.completedCount,
        total: completion.totalSections,
        percent: completion.percent,
      },
      completion: {
        complete: completion.complete,
        pendingSections: completion.pendingSectionTitles,
        pendingCheckpoints: completion.pendingCheckpoints,
      },
      storageConfigured: isStorageConfigured(),
      /** Drives the "Summarise with AI" affordance in the reader. */
      aiConfigured: isAiConfigured(),
      userId,
      attemptId,
    };
  },

  /** Completion state used by `LearningService.evaluateCompletion`. */
  async getCompletionState(attemptId: string, contentId: string) {
    const [sections, progress] = await Promise.all([
      prisma.readingSection.findMany({
        where: { contentId },
        orderBy: { orderIndex: 'asc' },
        include: { checkpoint: { include: { questions: { select: { id: true } } } } },
      }),
      prisma.readingSectionProgress.findMany({ where: { attemptId, contentId } }),
    ]);

    if (sections.length === 0) return { structured: false, ...evaluateReadingCompletion([], []) };

    const completed = new Set(progress.filter((row) => row.isCompleted).map((row) => row.sectionId));
    return {
      structured: true,
      ...evaluateReadingCompletion(
        sections.map((section) => ({
          id: section.id,
          title: section.title,
          orderIndex: section.orderIndex,
          hasCheckpoint: Boolean(section.checkpoint && section.checkpoint.questions.length > 0),
        })),
        completed,
      ),
    };
  },

  /** Progress summary surfaced on the learning hub and dashboards. */
  async readingSummaryForAttempt(attemptId: string, contentId: string) {
    const state = await this.getCompletionState(attemptId, contentId);
    return {
      structured: state.structured,
      completedSections: state.completedCount,
      totalSections: state.totalSections,
      percent: roundTo(state.percent, 1),
      pendingSections: state.pendingSectionTitles,
    };
  },

  /** Guard for learner mutations: the learner must own this attempt. */
  async assertAttemptOwner(attempt: { userId: string }, userId: string): Promise<void> {
    if (attempt.userId !== userId) throw forbidden('This course attempt belongs to another learner.');
  },
};
