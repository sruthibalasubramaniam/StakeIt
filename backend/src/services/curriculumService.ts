import type { AssessmentType, ContentType, QuestionType } from '@prisma/client';
import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { CourseService } from './courseService';

interface QuestionInput {
  type?: QuestionType;
  prompt: string;
  explanation?: string | null;
  points?: number;
  orderIndex?: number;
  options?: Array<{ label: string; detail?: string | null; isCorrect?: boolean; orderIndex?: number }>;
}

/** Gradable question types require at least one correct option. */
const AUTO_GRADED_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'TRUE_FALSE'];

function validateQuestion(question: QuestionInput, index: number): void {
  const type = question.type ?? 'SINGLE_CHOICE';
  if (!question.prompt?.trim()) {
    throw unprocessable('Every question needs a prompt.', 'VALIDATION_ERROR', { index });
  }
  if (!AUTO_GRADED_TYPES.includes(type)) return;

  const options = question.options ?? [];
  if (options.length < 2) {
    throw unprocessable('Choice questions need at least two options.', 'VALIDATION_ERROR', {
      index,
      prompt: question.prompt,
    });
  }
  const correct = options.filter((option) => option.isCorrect);
  if (correct.length === 0) {
    throw unprocessable('Mark at least one option as correct.', 'VALIDATION_ERROR', {
      index,
      prompt: question.prompt,
    });
  }
  if (type !== 'MULTI_CHOICE' && correct.length > 1) {
    throw unprocessable('Single-choice questions may only have one correct option.', 'VALIDATION_ERROR', {
      index,
      prompt: question.prompt,
    });
  }
}

async function nextOrderIndex(
  model: 'module' | 'content',
  parentId: string,
): Promise<number> {
  if (model === 'module') {
    const last = await prisma.module.findFirst({
      where: { courseId: parentId },
      orderBy: { orderIndex: 'desc' },
      select: { orderIndex: true },
    });
    return (last?.orderIndex ?? -1) + 1;
  }
  const last = await prisma.moduleContent.findFirst({
    where: { moduleId: parentId },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  });
  return (last?.orderIndex ?? -1) + 1;
}

export const CurriculumService = {
  /* ---------------------------------------------------------------------- */
  /* Modules                                                                 */
  /* ---------------------------------------------------------------------- */

  async listModules(courseId: string) {
    return prisma.module.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        contents: {
          orderBy: { orderIndex: 'asc' },
          include: {
            quiz: { select: { id: true, passingScore: true, maxAttempts: true, _count: { select: { questions: true } } } },
            assessment: {
              select: { id: true, title: true, passingScore: true, maxAttempts: true, type: true, _count: { select: { questions: true } } },
            },
          },
        },
      },
    });
  },

  async createModule(courseId: string, actorId: string, role: string, input: { title: string; summary?: string; isRequired?: boolean }) {
    await CourseService.assertInstructorOwnsCourse(courseId, actorId, role);
    if (!input.title?.trim()) throw badRequest('Module title is required.');

    const orderIndex = await nextOrderIndex('module', courseId);
    return prisma.module.create({
      data: {
        courseId,
        title: input.title.trim(),
        summary: input.summary?.trim() || null,
        isRequired: input.isRequired ?? true,
        orderIndex,
      },
      include: { contents: true },
    });
  },

  async updateModule(moduleId: string, actorId: string, role: string, input: { title?: string; summary?: string | null; isRequired?: boolean }) {
    const module = await prisma.module.findUnique({ where: { id: moduleId } });
    if (!module) throw notFound('Module');
    await CourseService.assertInstructorOwnsCourse(module.courseId, actorId, role);

    return prisma.module.update({
      where: { id: moduleId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.summary !== undefined ? { summary: input.summary?.trim() || null } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
      },
      include: { contents: { orderBy: { orderIndex: 'asc' } } },
    });
  },

  async deleteModule(moduleId: string, actorId: string, role: string) {
    const module = await prisma.module.findUnique({ where: { id: moduleId } });
    if (!module) throw notFound('Module');
    await CourseService.assertInstructorOwnsCourse(module.courseId, actorId, role);

    const blockers = await prisma.contentProgress.count({
      where: { content: { moduleId } },
    });
    if (blockers > 0) {
      throw conflict('This module has learner progress recorded and cannot be deleted.');
    }

    await prisma.module.delete({ where: { id: moduleId } });
    await this.compactModuleOrder(module.courseId);
    return { id: moduleId, deleted: true };
  },

  /** Reorders modules; `orderedIds` must be a permutation of the course's modules. */
  async reorderModules(courseId: string, actorId: string, role: string, orderedIds: string[]) {
    await CourseService.assertInstructorOwnsCourse(courseId, actorId, role);

    const modules = await prisma.module.findMany({ where: { courseId }, select: { id: true } });
    const existing = new Set(modules.map((module) => module.id));

    if (orderedIds.length !== modules.length || orderedIds.some((id) => !existing.has(id))) {
      throw badRequest('The reorder payload must contain every module of this course exactly once.', {
        expected: modules.length,
        received: orderedIds.length,
      });
    }

    await withTransaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.module.update({ where: { id }, data: { orderIndex: index } });
      }
    });

    return this.listModules(courseId);
  },

  async compactModuleOrder(courseId: string): Promise<void> {
    const modules = await prisma.module.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true },
    });
    await withTransaction(async (tx) => {
      for (const [index, module] of modules.entries()) {
        await tx.module.update({ where: { id: module.id }, data: { orderIndex: index } });
      }
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Content                                                                 */
  /* ---------------------------------------------------------------------- */

  async createContent(
    moduleId: string,
    actorId: string,
    role: string,
    input: {
      type: ContentType;
      title: string;
      description?: string;
      isRequired?: boolean;
      estimatedMinutes?: number;
      videoUrl?: string;
      durationSeconds?: number;
      requiredWatchPercent?: number;
      readingBody?: string;
      requiresComprehensionCheck?: boolean;
      comprehensionPrompt?: string;
      comprehensionAnswer?: string;
      passingScore?: number;
      maxAttempts?: number;
      timeLimitMinutes?: number;
    },
  ) {
    const module = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
    if (!module) throw notFound('Module');
    await CourseService.assertInstructorOwnsCourse(module.courseId, actorId, role);

    if (!input.title?.trim()) throw badRequest('Content title is required.');
    if (input.type === 'VIDEO' && !input.videoUrl) throw badRequest('Video content requires a video URL.');
    if (input.type === 'READING' && !input.readingBody) throw badRequest('Reading content requires a body.');
    if (input.type === 'READING' && input.requiresComprehensionCheck && !input.comprehensionAnswer) {
      throw badRequest('A comprehension check requires a reference answer.');
    }

    const orderIndex = await nextOrderIndex('content', moduleId);

    return withTransaction(async (tx) => {
      const content = await tx.moduleContent.create({
        data: {
          moduleId,
          type: input.type,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          orderIndex,
          isRequired: input.isRequired ?? true,
          estimatedMinutes: input.estimatedMinutes ?? null,
          videoUrl: input.videoUrl ?? null,
          durationSeconds: input.durationSeconds ?? null,
          requiredWatchPercent: input.requiredWatchPercent ?? null,
          readingBody: input.readingBody ?? null,
          requiresComprehensionCheck: input.requiresComprehensionCheck ?? false,
          comprehensionPrompt: input.comprehensionPrompt ?? null,
          comprehensionAnswer: input.comprehensionAnswer ?? null,
        },
      });

      // QUIZ and MODULE_ASSESSMENT contents own their instrument row.
      if (input.type === 'QUIZ') {
        await tx.quiz.create({
          data: {
            contentId: content.id,
            title: content.title,
            passingScore: input.passingScore ?? 70,
            maxAttempts: input.maxAttempts ?? null,
            timeLimitMinutes: input.timeLimitMinutes ?? null,
          },
        });
      }

      if (input.type === 'MODULE_ASSESSMENT') {
        await tx.assessment.create({
          data: {
            courseId: module.courseId,
            moduleId,
            contentId: content.id,
            type: 'MODULE',
            title: content.title,
            passingScore: input.passingScore ?? 70,
            maxAttempts: input.maxAttempts ?? null,
            timeLimitMinutes: input.timeLimitMinutes ?? null,
          },
        });
      }

      return tx.moduleContent.findUniqueOrThrow({
        where: { id: content.id },
        include: {
          quiz: { include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } } },
          assessment: { include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } } },
        },
      });
    });
  },

  async updateContent(contentId: string, actorId: string, role: string, input: Record<string, unknown>) {
    const content = await prisma.moduleContent.findUnique({ where: { id: contentId }, include: { module: true } });
    if (!content) throw notFound('Content');
    await CourseService.assertInstructorOwnsCourse(content.module.courseId, actorId, role);

    return prisma.moduleContent.update({
      where: { id: contentId },
      data: {
        ...(input.title !== undefined ? { title: String(input.title).trim() } : {}),
        ...(input.description !== undefined ? { description: (input.description as string) || null } : {}),
        ...(input.isRequired !== undefined ? { isRequired: Boolean(input.isRequired) } : {}),
        ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes as number | null } : {}),
        ...(input.videoUrl !== undefined ? { videoUrl: (input.videoUrl as string) || null } : {}),
        ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds as number | null } : {}),
        ...(input.requiredWatchPercent !== undefined
          ? { requiredWatchPercent: input.requiredWatchPercent as number | null }
          : {}),
        ...(input.readingBody !== undefined ? { readingBody: (input.readingBody as string) || null } : {}),
        ...(input.requiresComprehensionCheck !== undefined
          ? { requiresComprehensionCheck: Boolean(input.requiresComprehensionCheck) }
          : {}),
        ...(input.comprehensionPrompt !== undefined
          ? { comprehensionPrompt: (input.comprehensionPrompt as string) || null }
          : {}),
        ...(input.comprehensionAnswer !== undefined
          ? { comprehensionAnswer: (input.comprehensionAnswer as string) || null }
          : {}),
      },
    });
  },

  async deleteContent(contentId: string, actorId: string, role: string) {
    const content = await prisma.moduleContent.findUnique({ where: { id: contentId }, include: { module: true } });
    if (!content) throw notFound('Content');
    await CourseService.assertInstructorOwnsCourse(content.module.courseId, actorId, role);

    const progress = await prisma.contentProgress.count({ where: { contentId } });
    if (progress > 0) {
      throw conflict('This content item already has learner progress and cannot be deleted.');
    }

    await prisma.moduleContent.delete({ where: { id: contentId } });
    await this.compactContentOrder(content.moduleId);
    return { id: contentId, deleted: true };
  },

  async reorderContent(moduleId: string, actorId: string, role: string, orderedIds: string[]) {
    const module = await prisma.module.findUnique({ where: { id: moduleId }, include: { contents: { select: { id: true } } } });
    if (!module) throw notFound('Module');
    await CourseService.assertInstructorOwnsCourse(module.courseId, actorId, role);

    const existing = new Set(module.contents.map((content) => content.id));
    if (orderedIds.length !== module.contents.length || orderedIds.some((id) => !existing.has(id))) {
      throw badRequest('The reorder payload must contain every content item of this module exactly once.', {
        expected: module.contents.length,
        received: orderedIds.length,
      });
    }

    await withTransaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.moduleContent.update({ where: { id }, data: { orderIndex: index } });
      }
    });

    return prisma.moduleContent.findMany({ where: { moduleId }, orderBy: { orderIndex: 'asc' } });
  },

  async compactContentOrder(moduleId: string): Promise<void> {
    const contents = await prisma.moduleContent.findMany({
      where: { moduleId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true },
    });
    await withTransaction(async (tx) => {
      for (const [index, content] of contents.entries()) {
        await tx.moduleContent.update({ where: { id: content.id }, data: { orderIndex: index } });
      }
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Questions                                                               */
  /* ---------------------------------------------------------------------- */

  /** Replaces the whole question set for a quiz (authoring is atomic). */
  async replaceQuizQuestions(quizId: string, actorId: string, role: string, questions: QuestionInput[]) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { content: { include: { module: true } } },
    });
    if (!quiz) throw notFound('Quiz');
    await CourseService.assertInstructorOwnsCourse(quiz.content.module.courseId, actorId, role);

    questions.forEach(validateQuestion);

    return withTransaction(async (tx) => {
      await tx.quizQuestion.deleteMany({ where: { quizId } });
      for (const [index, question] of questions.entries()) {
        await tx.quizQuestion.create({
          data: {
            quizId,
            type: question.type ?? 'SINGLE_CHOICE',
            prompt: question.prompt.trim(),
            explanation: question.explanation ?? null,
            points: question.points ?? 1,
            orderIndex: question.orderIndex ?? index,
            options: {
              create: (question.options ?? []).map((option, optionIndex) => ({
                label: option.label.trim(),
                detail: option.detail ?? null,
                isCorrect: option.isCorrect ?? false,
                orderIndex: option.orderIndex ?? optionIndex,
              })),
            },
          },
        });
      }
      return tx.quiz.findUniqueOrThrow({
        where: { id: quizId },
        include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } },
      });
    });
  },

  async updateQuizSettings(
    quizId: string,
    actorId: string,
    role: string,
    input: {
      title?: string;
      description?: string | null;
      passingScore?: number;
      maxAttempts?: number | null;
      timeLimitMinutes?: number | null;
      shuffleQuestions?: boolean;
    },
  ) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { content: { include: { module: true } } },
    });
    if (!quiz) throw notFound('Quiz');
    await CourseService.assertInstructorOwnsCourse(quiz.content.module.courseId, actorId, role);

    return prisma.quiz.update({
      where: { id: quizId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.timeLimitMinutes !== undefined ? { timeLimitMinutes: input.timeLimitMinutes } : {}),
        ...(input.shuffleQuestions !== undefined ? { shuffleQuestions: input.shuffleQuestions } : {}),
      },
    });
  },

  async replaceAssessmentQuestions(
    assessmentId: string,
    actorId: string,
    role: string,
    questions: QuestionInput[],
  ) {
    const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw notFound('Assessment');
    await CourseService.assertInstructorOwnsCourse(assessment.courseId, actorId, role);

    questions.forEach(validateQuestion);

    return withTransaction(async (tx) => {
      await tx.assessmentQuestion.deleteMany({ where: { assessmentId } });
      for (const [index, question] of questions.entries()) {
        await tx.assessmentQuestion.create({
          data: {
            assessmentId,
            type: question.type ?? 'SINGLE_CHOICE',
            prompt: question.prompt.trim(),
            explanation: question.explanation ?? null,
            points: question.points ?? 1,
            orderIndex: question.orderIndex ?? index,
            options: {
              create: (question.options ?? []).map((option, optionIndex) => ({
                label: option.label.trim(),
                detail: option.detail ?? null,
                isCorrect: option.isCorrect ?? false,
                orderIndex: option.orderIndex ?? optionIndex,
              })),
            },
          },
        });
      }
      return tx.assessment.findUniqueOrThrow({
        where: { id: assessmentId },
        include: {
          questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } },
        },
      });
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Final assessment                                                        */
  /* ---------------------------------------------------------------------- */

  async upsertFinalAssessment(
    courseId: string,
    actorId: string,
    role: string,
    input: { title?: string; description?: string; passingScore?: number; maxAttempts?: number; timeLimitMinutes?: number },
  ) {
    await CourseService.assertInstructorOwnsCourse(courseId, actorId, role);

    const existing = await prisma.assessment.findFirst({ where: { courseId, type: 'FINAL' } });

    if (existing) {
      return prisma.assessment.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.description !== undefined ? { description: (input.description as string) || null } : {}),
          ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
          ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
          ...(input.timeLimitMinutes !== undefined ? { timeLimitMinutes: input.timeLimitMinutes } : {}),
        },
      });
    }

    return prisma.assessment.create({
      data: {
        courseId,
        type: 'FINAL',
        title: input.title?.trim() || 'Final Course Assessment',
        description: input.description ?? null,
        passingScore: input.passingScore ?? 70,
        maxAttempts: input.maxAttempts ?? 1,
        timeLimitMinutes: input.timeLimitMinutes ?? null,
      },
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Commitment options                                                      */
  /* ---------------------------------------------------------------------- */

  async replaceCommitmentOptions(
    courseId: string,
    actorId: string,
    role: string,
    options: Array<{ label: string; durationDays: number; commitmentStake: number; commitmentBonus: number; isDefault?: boolean }>,
  ) {
    const course = await CourseService.assertInstructorOwnsCourse(courseId, actorId, role);

    options.forEach((option, index) => {
      if (!option.label?.trim()) throw badRequest('Every accelerated option needs a label.', { index });
      if (option.durationDays <= 0 || option.durationDays >= course.durationDays) {
        throw badRequest(
          `Accelerated duration must be between 1 and ${course.durationDays - 1} days.`,
          { index, value: option.durationDays },
        );
      }
      if (option.commitmentStake <= 0) {
        throw badRequest('Accelerated options require a positive commitment stake.', { index });
      }
    });

    const defaults = options.filter((option) => option.isDefault).length;
    if (defaults > 1) throw badRequest('Only one accelerated option can be the default.');

    return withTransaction(async (tx) => {
      await tx.courseCommitmentOption.deleteMany({ where: { courseId } });
      for (const [index, option] of options.entries()) {
        await tx.courseCommitmentOption.create({
          data: {
            courseId,
            label: option.label.trim(),
            durationDays: option.durationDays,
            commitmentStake: option.commitmentStake,
            commitmentBonus: option.commitmentBonus,
            isDefault: option.isDefault ?? index === 0,
            orderIndex: index,
          },
        });
      }
      return tx.courseCommitmentOption.findMany({ where: { courseId }, orderBy: { orderIndex: 'asc' } });
    });
  },

  /** Read-only preview used by the builder's "Preview" step. */
  async previewCourse(courseId: string) {
    return CourseService.getByIdOrSlug(courseId, { role: 'ADMIN', userId: 'preview' });
  },

  /** Authenticated preview used before publishing. */
  async previewForInstructor(courseId: string, actorId: string, role: string) {
    await CourseService.assertInstructorOwnsCourse(courseId, actorId, role);
    return CourseService.getByIdOrSlug(courseId, { role, userId: actorId });
  },

  async assertAssessmentInCourse(assessmentId: string, courseId: string): Promise<AssessmentType> {
    const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw notFound('Assessment');
    if (assessment.courseId !== courseId) throw badRequest('Assessment does not belong to this course.');
    return assessment.type;
  },
};
