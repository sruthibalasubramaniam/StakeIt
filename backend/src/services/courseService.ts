import type { ContentType, Course, CourseStatus, Difficulty, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { resolvePagination, paginated, toStringArray } from '../utils/http';
import { roundTo } from '../utils/date';
import { REPUTATION_MARKET_WEIGHTS } from '../config/constants';
import { toInstructorCard } from '../utils/serializers';

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export interface CourseConfigurationInput {
  moduleWeight?: number;
  finalTestWeight?: number;
  moduleQuizWeight?: number;
  moduleAssessmentWeight?: number;
  performanceThreshold?: number;
  durationDays?: number;
  gracePeriodHours?: number;
  baseStake?: number;
  completionReward?: number;
  commitmentBonus?: number;
  performanceBonus?: number;
  minFinalTestScore?: number | null;
  maxAttempts?: number;
  requiredWatchPercent?: number;
}

/**
 * Enforces the arithmetic invariants the whole reward engine depends on.
 * Weights must total exactly 100% — a course that slips through here would
 * silently mis-score every learner.
 */
export function assertValidConfiguration(config: CourseConfigurationInput, context: 'create' | 'update' = 'create'): void {
  const issues: Array<{ field: string; message: string }> = [];

  const moduleWeight = config.moduleWeight;
  const finalTestWeight = config.finalTestWeight;
  if (moduleWeight !== undefined && finalTestWeight !== undefined) {
    if (moduleWeight < 0 || finalTestWeight < 0) {
      issues.push({ field: 'moduleWeight', message: 'Weights cannot be negative.' });
    }
    if (moduleWeight + finalTestWeight !== 100) {
      issues.push({
        field: 'moduleWeight',
        message: `Module weight (${moduleWeight}%) and final test weight (${finalTestWeight}%) must total exactly 100%.`,
      });
    }
  } else if (context === 'create' && (moduleWeight !== undefined || finalTestWeight !== undefined)) {
    issues.push({
      field: 'moduleWeight',
      message: 'Both moduleWeight and finalTestWeight are required together.',
    });
  }

  const quizWeight = config.moduleQuizWeight;
  const assessmentWeight = config.moduleAssessmentWeight;
  if (quizWeight !== undefined && assessmentWeight !== undefined && quizWeight + assessmentWeight !== 100) {
    issues.push({
      field: 'moduleQuizWeight',
      message: `Module quiz weight (${quizWeight}%) and module assessment weight (${assessmentWeight}%) must total exactly 100%.`,
    });
  }

  if (config.performanceThreshold !== undefined && (config.performanceThreshold < 0 || config.performanceThreshold > 100)) {
    issues.push({ field: 'performanceThreshold', message: 'Performance threshold must be between 0 and 100.' });
  }
  if (config.minFinalTestScore !== undefined && config.minFinalTestScore !== null) {
    if (config.minFinalTestScore < 0 || config.minFinalTestScore > 100) {
      issues.push({ field: 'minFinalTestScore', message: 'Minimum final test score must be between 0 and 100.' });
    }
  }
  if (config.durationDays !== undefined && config.durationDays < 1) {
    issues.push({ field: 'durationDays', message: 'Course duration must be at least 1 day.' });
  }
  if (config.gracePeriodHours !== undefined && config.gracePeriodHours < 0) {
    issues.push({ field: 'gracePeriodHours', message: 'Grace period cannot be negative.' });
  }
  if (config.baseStake !== undefined && config.baseStake < 0) {
    issues.push({ field: 'baseStake', message: 'Base stake cannot be negative.' });
  }
  if (config.completionReward !== undefined && config.completionReward < 0) {
    issues.push({ field: 'completionReward', message: 'Completion reward cannot be negative.' });
  }
  if (config.maxAttempts !== undefined && config.maxAttempts < 1) {
    issues.push({ field: 'maxAttempts', message: 'Maximum attempts must be at least 1.' });
  }
  if (config.requiredWatchPercent !== undefined && (config.requiredWatchPercent < 1 || config.requiredWatchPercent > 100)) {
    issues.push({ field: 'requiredWatchPercent', message: 'Required watch percentage must be between 1 and 100.' });
  }

  if (issues.length > 0) {
    // The summary names the first problem so the message is actionable on its
    // own; the full list stays available under `details.issues`.
    const summary = issues.map((issue) => issue.message).join(' ');
    throw unprocessable(`The course configuration is invalid. ${summary}`, 'INVALID_COURSE_CONFIGURATION', {
      issues,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

const instructorSelect = {
  id: true,
  fullName: true,
  headline: true,
  bio: true,
  avatarUrl: true,
  expertise: true,
  badges: { where: { isActive: true }, orderBy: { awardedAt: 'desc' } },
  _count: { select: { coursesTaught: true } },
} satisfies Prisma.UserSelect;

type CourseWithRelations = Course & {
  instructor: Prisma.UserGetPayload<{ select: typeof instructorSelect }>;
  _count?: { enrollments: number; modules: number };
  reviews?: Array<{ rating: number; difficultyRating: number | null; wouldRecommend: boolean }>;
  commitmentOptions?: Array<{ id: string; label: string; durationDays: number; commitmentStake: number; commitmentBonus: number; isDefault: boolean }>;
};

export function toCourseSummary(course: CourseWithRelations) {
  const ratings = course.reviews ?? [];
  const averageRating = ratings.length
    ? roundTo(ratings.reduce((sum, review) => sum + review.rating, 0) / ratings.length, 2)
    : null;
  const averageDifficulty = ratings.filter((r) => r.difficultyRating).length
    ? roundTo(
        ratings.reduce((sum, review) => sum + (review.difficultyRating ?? 0), 0) /
          ratings.filter((r) => r.difficultyRating).length,
        2,
      )
    : null;

  return {
    id: course.id,
    code: course.code,
    slug: course.slug,
    title: course.title,
    shortDescription: course.shortDescription,
    category: course.category,
    difficulty: course.difficulty,
    coverImageUrl: course.coverImageUrl,
    tags: course.tags,
    status: course.status,
    durationDays: course.durationDays,
    gracePeriodHours: course.gracePeriodHours,
    baseStake: course.baseStake,
    completionReward: course.completionReward,
    commitmentBonus: course.commitmentBonus,
    performanceBonus: course.performanceBonus,
    performanceThreshold: course.performanceThreshold,
    maxAttempts: course.maxAttempts,
    totalPotentialReturn: course.baseStake + course.completionReward + course.commitmentBonus + course.performanceBonus,
    instructor: toInstructorCard(course.instructor),
    moduleCount: course._count?.modules ?? undefined,
    learnerCount: course._count?.enrollments ?? undefined,
    ratingCount: ratings.length,
    averageRating,
    averageDifficulty,
    recommendationRate: ratings.length
      ? roundTo(ratings.filter((r) => r.wouldRecommend).length / ratings.length, 3)
      : null,
    publishedAt: course.publishedAt,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    commitmentOptions: course.commitmentOptions,
  };
}

/** Full course payload. Answer keys are stripped for learners. */
export function toCourseDetail(
  course: CourseWithRelations & {
    modules: Array<{
      id: string;
      title: string;
      summary: string | null;
      orderIndex: number;
      isRequired: boolean;
      contents: Array<{
        id: string;
        type: ContentType;
        title: string;
        description: string | null;
        orderIndex: number;
        isRequired: boolean;
        estimatedMinutes: number | null;
        durationSeconds: number | null;
        requiredWatchPercent: number | null;
        quiz: { id: string; passingScore: number; questions: Array<unknown> } | null;
        assessment: { id: string; title: string; passingScore: number; type: string } | null;
      }>;
    }>;
    assessments: Array<{ id: string; type: string; title: string; description: string | null; passingScore: number; maxAttempts: number | null; timeLimitMinutes: number | null }>;
  },
  options: { includeAnswerKeys: boolean; includeReadingBody: boolean },
) {
  const summary = toCourseSummary(course);

  const structure = {
    ...summary,
    description: course.description,
    moduleWeight: course.moduleWeight,
    finalTestWeight: course.finalTestWeight,
    minFinalTestScore: course.minFinalTestScore,
    moduleQuizWeight: course.moduleQuizWeight,
    moduleAssessmentWeight: course.moduleAssessmentWeight,
    requiredWatchPercent: course.requiredWatchPercent,
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      summary: module.summary,
      orderIndex: module.orderIndex,
      isRequired: module.isRequired,
      contents: module.contents.map((content) => ({
        id: content.id,
        type: content.type,
        title: content.title,
        description: content.description,
        orderIndex: content.orderIndex,
        isRequired: content.isRequired,
        estimatedMinutes: content.estimatedMinutes,
        durationSeconds: content.durationSeconds,
        requiredWatchPercent: content.requiredWatchPercent,
        quiz: content.quiz
          ? {
              id: content.quiz.id,
              passingScore: content.quiz.passingScore,
              questionCount: content.quiz.questions.length,
            }
          : null,
        assessment: content.assessment
          ? {
              id: content.assessment.id,
              title: content.assessment.title,
              passingScore: content.assessment.passingScore,
              type: content.assessment.type,
            }
          : null,
      })),
    })),
    finalAssessment: course.assessments.find((assessment) => assessment.type === 'FINAL') ?? null,
    moduleAssessments: course.assessments.filter((assessment) => assessment.type === 'MODULE'),
  };

  void options;
  return structure;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

async function uniqueSlug(title: string, ignoreCourseId?: string): Promise<string> {
  const base = slugify(title) || 'course';
  let candidate = base;
  let counter = 1;
  // Bounded loop; slugs are cosmetic so a numeric suffix is acceptable.
  while (counter < 200) {
    const existing = await prisma.course.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === ignoreCourseId) return candidate;
    counter += 1;
    candidate = `${base}-${counter}`;
  }
  return `${base}-${Date.now()}`;
}

async function uniqueCode(title: string): Promise<string> {
  const prefix = (slugify(title).split('-')[0] ?? 'CRS').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const existing = await prisma.course.count();
  let counter = existing + 1;
  // Course codes are human-readable identifiers, e.g. `FUL-104`.
  while (counter < 100_000) {
    const code = `${prefix}-${100 + counter}`;
    const clash = await prisma.course.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
    counter += 1;
  }
  return `${prefix}-${Date.now() % 10_000}`;
}

export interface CourseListQuery {
  q?: string;
  category?: string;
  difficulty?: string;
  status?: string;
  instructorId?: string;
  tags?: string;
  sort?: string;
  page?: unknown;
  pageSize?: unknown;
  includeUnpublished?: boolean;
}

export const CourseService = {
  async list(query: CourseListQuery, viewer?: { role: string; userId: string }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.CourseWhereInput = {};
    const and: Prisma.CourseWhereInput[] = [];

    // Visibility: learners only ever see published courses. Instructors see
    // their own drafts; admins see everything.
    if (viewer?.role === 'ADMIN') {
      if (query.status && query.status !== 'ALL') where.status = query.status as CourseStatus;
    } else if (viewer?.role === 'INSTRUCTOR' && query.instructorId === viewer.userId && query.includeUnpublished) {
      if (query.status && query.status !== 'ALL') where.status = query.status as CourseStatus;
    } else {
      where.status = 'PUBLISHED';
    }

    if (query.instructorId) where.instructorId = query.instructorId;
    if (query.category && query.category !== 'ALL') where.category = query.category;
    if (query.difficulty && query.difficulty !== 'ALL') where.difficulty = query.difficulty as Difficulty;

    const tags = toStringArray(query.tags);
    if (tags.length) where.tags = { hasSome: tags };

    if (query.q && query.q.trim()) {
      const term = query.q.trim();
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { shortDescription: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
          { code: { contains: term, mode: 'insensitive' } },
          { instructor: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }

    if (and.length) where.AND = and;

    const orderBy = ((): Prisma.CourseOrderByWithRelationInput => {
      switch (query.sort) {
        case 'popular':
          return { enrollments: { _count: 'desc' } };
        case 'stake':
          return { baseStake: 'desc' };
        case 'duration':
          return { durationDays: 'asc' };
        case 'title':
          return { title: 'asc' };
        case 'newest':
        default:
          return { publishedAt: 'desc' };
      }
    })();

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy: [orderBy, { createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          instructor: { select: instructorSelect },
          commitmentOptions: {
            where: { isActive: true },
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              label: true,
              durationDays: true,
              commitmentStake: true,
              commitmentBonus: true,
              isDefault: true,
            },
          },
          reviews: { where: { isPublished: true }, select: { rating: true, difficultyRating: true, wouldRecommend: true } },
          _count: { select: { enrollments: true, modules: true } },
        },
      }),
      prisma.course.count({ where }),
    ]);

    const items = courses.map(toCourseSummary);

    // Reputation influences ranking only — never stake pricing.
    if (query.sort === 'reputation') {
      items.sort((a, b) => {
        const boost = (course: typeof a) => {
          const badgeRank = { GOLD: 3, SILVER: 2, BRONZE: 1, NONE: 0 } as Record<string, number>;
          return (badgeRank[course.instructor.badge] ?? 0) * REPUTATION_MARKET_WEIGHTS.searchBoostMultiplier +
            (course.averageRating ?? 0) / 5;
        };
        return boost(b) - boost(a);
      });
    }

    return paginated(items, total, pagination);
  },

  /** Lightweight facets for the course-browse filter rail. */
  async facets() {
    const [categories, difficulties] = await Promise.all([
      prisma.course.groupBy({ by: ['category'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
      prisma.course.groupBy({ by: ['difficulty'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
    ]);

    return {
      categories: categories
        .map((entry) => ({ value: entry.category, count: entry._count._all }))
        .sort((a, b) => b.count - a.count),
      difficulties: difficulties.map((entry) => ({ value: entry.difficulty, count: entry._count._all })),
    };
  },

  async getByIdOrSlug(idOrSlug: string, viewer?: { role: string; userId: string }) {
    const course = await prisma.course.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }, { code: idOrSlug }] },
      include: {
        instructor: { select: instructorSelect },
        commitmentOptions: { where: { isActive: true }, orderBy: { orderIndex: 'asc' } },
        reviews: { where: { isPublished: true }, select: { rating: true, difficultyRating: true, wouldRecommend: true } },
        _count: { select: { enrollments: true, modules: true } },
        modules: {
          orderBy: { orderIndex: 'asc' },
          include: {
            contents: {
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true,
                type: true,
                title: true,
                description: true,
                orderIndex: true,
                isRequired: true,
                estimatedMinutes: true,
                durationSeconds: true,
                requiredWatchPercent: true,
                quiz: { select: { id: true, passingScore: true, questions: { select: { id: true } } } },
                assessment: { select: { id: true, title: true, passingScore: true, type: true } },
              },
            },
          },
        },
        assessments: {
          where: { type: 'FINAL' },
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            passingScore: true,
            maxAttempts: true,
            timeLimitMinutes: true,
            _count: { select: { questions: true } },
          },
        },
      },
    });

    if (!course) throw notFound('Course');

    const isOwner = viewer?.userId === course.instructorId;
    const isAdmin = viewer?.role === 'ADMIN';

    if (course.status !== 'PUBLISHED' && !isOwner && !isAdmin) {
      throw forbidden('This course is not published yet.');
    }

    return toCourseDetail(course as never, { includeAnswerKeys: isOwner || isAdmin, includeReadingBody: false });
  },

  async assertInstructorOwnsCourse(courseId: string, userId: string, role: string): Promise<Course> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw notFound('Course');
    if (role !== 'ADMIN' && course.instructorId !== userId) {
      throw forbidden('You can only manage courses you own.');
    }
    return course;
  },

  async create(
    instructorId: string,
    input: {
      title: string;
      shortDescription: string;
      description: string;
      category: string;
      difficulty?: Difficulty;
      coverImageUrl?: string | null;
      tags?: string[];
    } & CourseConfigurationInput,
  ) {
    assertValidConfiguration(input, 'create');

    const [slug, code] = await Promise.all([uniqueSlug(input.title), uniqueCode(input.title)]);

    const course = await prisma.course.create({
      data: {
        code,
        slug,
        title: input.title.trim(),
        shortDescription: input.shortDescription.trim(),
        description: input.description.trim(),
        category: input.category.trim(),
        difficulty: input.difficulty ?? 'INTERMEDIATE',
        coverImageUrl: input.coverImageUrl ?? null,
        tags: input.tags ?? [],
        instructorId,
        status: 'DRAFT',
        baseStake: input.baseStake ?? 100,
        completionReward: input.completionReward ?? 50,
        commitmentBonus: input.commitmentBonus ?? 0,
        performanceBonus: input.performanceBonus ?? 0,
        performanceThreshold: input.performanceThreshold ?? 90,
        durationDays: input.durationDays ?? 30,
        gracePeriodHours: input.gracePeriodHours ?? 24,
        moduleWeight: input.moduleWeight ?? 70,
        finalTestWeight: input.finalTestWeight ?? 30,
        moduleQuizWeight: input.moduleQuizWeight ?? 30,
        moduleAssessmentWeight: input.moduleAssessmentWeight ?? 70,
        minFinalTestScore: input.minFinalTestScore ?? null,
        maxAttempts: input.maxAttempts ?? 3,
        requiredWatchPercent: input.requiredWatchPercent ?? 90,
      },
      include: { instructor: { select: instructorSelect }, _count: { select: { enrollments: true, modules: true } } },
    });

    return toCourseSummary(course as never);
  },

  async update(courseId: string, actorId: string, role: string, input: Record<string, unknown>) {
    const existing = await this.assertInstructorOwnsCourse(courseId, actorId, role);

    // Merge incoming config over the stored config so partial updates still
    // validate against the full picture (e.g. only moduleWeight is sent).
    assertValidConfiguration(
      {
        moduleWeight: (input.moduleWeight as number) ?? existing.moduleWeight,
        finalTestWeight: (input.finalTestWeight as number) ?? existing.finalTestWeight,
        moduleQuizWeight: (input.moduleQuizWeight as number) ?? existing.moduleQuizWeight,
        moduleAssessmentWeight: (input.moduleAssessmentWeight as number) ?? existing.moduleAssessmentWeight,
        performanceThreshold: (input.performanceThreshold as number) ?? existing.performanceThreshold,
        durationDays: (input.durationDays as number) ?? existing.durationDays,
        gracePeriodHours: (input.gracePeriodHours as number) ?? existing.gracePeriodHours,
        baseStake: (input.baseStake as number) ?? existing.baseStake,
        completionReward: (input.completionReward as number) ?? existing.completionReward,
        commitmentBonus: (input.commitmentBonus as number) ?? existing.commitmentBonus,
        performanceBonus: (input.performanceBonus as number) ?? existing.performanceBonus,
        minFinalTestScore:
          input.minFinalTestScore === undefined ? existing.minFinalTestScore : (input.minFinalTestScore as number | null),
        maxAttempts: (input.maxAttempts as number) ?? existing.maxAttempts,
        requiredWatchPercent: (input.requiredWatchPercent as number) ?? existing.requiredWatchPercent,
      },
      'update',
    );

    // Changing the stake while learners are mid-attempt would make already
    // locked amounts ambiguous, so published-course economics are frozen.
    if (existing.status === 'PUBLISHED') {
      const frozen: Array<keyof CourseConfigurationInput> = ['baseStake', 'completionReward', 'commitmentBonus', 'performanceBonus'];
      for (const field of frozen) {
        if (input[field] !== undefined && input[field] !== (existing as unknown as Record<string, unknown>)[field]) {
          throw conflict(
            `${field} cannot be changed while the course is published. Unpublish it first.`,
            'CONFLICT',
            { field, currentValue: (existing as unknown as Record<string, unknown>)[field] },
          );
        }
      }
    }

    const title = (input.title as string | undefined)?.trim();
    const slug = title && title !== existing.title ? await uniqueSlug(title, courseId) : undefined;

    const course = await prisma.course.update({
      where: { id: courseId },
      data: {
        ...(title ? { title, ...(slug ? { slug } : {}) } : {}),
        ...(input.shortDescription !== undefined ? { shortDescription: String(input.shortDescription).trim() } : {}),
        ...(input.description !== undefined ? { description: String(input.description).trim() } : {}),
        ...(input.category !== undefined ? { category: String(input.category).trim() } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty as Difficulty } : {}),
        ...(input.coverImageUrl !== undefined ? { coverImageUrl: (input.coverImageUrl as string) || null } : {}),
        ...(input.tags !== undefined ? { tags: input.tags as string[] } : {}),
        ...(input.baseStake !== undefined ? { baseStake: input.baseStake as number } : {}),
        ...(input.completionReward !== undefined ? { completionReward: input.completionReward as number } : {}),
        ...(input.commitmentBonus !== undefined ? { commitmentBonus: input.commitmentBonus as number } : {}),
        ...(input.performanceBonus !== undefined ? { performanceBonus: input.performanceBonus as number } : {}),
        ...(input.performanceThreshold !== undefined ? { performanceThreshold: input.performanceThreshold as number } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays as number } : {}),
        ...(input.gracePeriodHours !== undefined ? { gracePeriodHours: input.gracePeriodHours as number } : {}),
        ...(input.moduleWeight !== undefined ? { moduleWeight: input.moduleWeight as number } : {}),
        ...(input.finalTestWeight !== undefined ? { finalTestWeight: input.finalTestWeight as number } : {}),
        ...(input.moduleQuizWeight !== undefined ? { moduleQuizWeight: input.moduleQuizWeight as number } : {}),
        ...(input.moduleAssessmentWeight !== undefined ? { moduleAssessmentWeight: input.moduleAssessmentWeight as number } : {}),
        ...(input.minFinalTestScore !== undefined ? { minFinalTestScore: input.minFinalTestScore as number | null } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts as number } : {}),
        ...(input.requiredWatchPercent !== undefined ? { requiredWatchPercent: input.requiredWatchPercent as number } : {}),
      },
      include: { instructor: { select: instructorSelect }, _count: { select: { enrollments: true, modules: true } } },
    });

    return toCourseSummary(course as never);
  },

  /**
   * Publish gate. A course cannot go live without a complete, internally
   * consistent curriculum — otherwise learners could stake on a dead end.
   */
  async publish(courseId: string, actorId: string, role: string) {
    await this.assertInstructorOwnsCourse(courseId, actorId, role);

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        modules: { orderBy: { orderIndex: 'asc' }, include: { contents: { orderBy: { orderIndex: 'asc' } } } },
        assessments: { include: { _count: { select: { questions: true } } } },
        commitmentOptions: true,
      },
    });
    if (!course) throw notFound('Course');

    const blocking: Array<{ field: string; message: string }> = [];

    assertValidConfiguration(course, 'update');

    if (course.modules.length === 0) {
      blocking.push({ field: 'modules', message: 'Add at least one module before publishing.' });
    }

    course.modules.forEach((module, index) => {
      const required = module.contents.filter((content) => content.isRequired);
      if (required.length === 0) {
        blocking.push({
          field: `modules[${index}]`,
          message: `Module ${index + 1} ("${module.title}") has no required content.`,
        });
      }
      required.forEach((content) => {
        if (content.type === 'VIDEO' && !content.videoUrl) {
          blocking.push({
            field: `content:${content.id}`,
            message: `Video content "${content.title}" is missing a video URL.`,
          });
        }
        if (content.type === 'READING' && !content.readingBody) {
          blocking.push({
            field: `content:${content.id}`,
            message: `Reading content "${content.title}" is missing its body.`,
          });
        }
      });
    });

    const quizContent = course.modules.flatMap((module) => module.contents).filter((content) => content.type === 'QUIZ');
    if (quizContent.length > 0) {
      const quizzes = await prisma.quiz.findMany({
        where: { contentId: { in: quizContent.map((content) => content.id) } },
        include: { _count: { select: { questions: true } } },
      });
      const idsWithQuestions = new Set(quizzes.filter((quiz) => quiz._count.questions > 0).map((quiz) => quiz.contentId));
      quizContent.forEach((content) => {
        if (!idsWithQuestions.has(content.id)) {
          blocking.push({ field: `content:${content.id}`, message: `Quiz "${content.title}" has no questions.` });
        }
      });
    }

    const assessmentContent = course.modules
      .flatMap((module) => module.contents)
      .filter((content) => content.type === 'MODULE_ASSESSMENT');
    if (assessmentContent.length > 0) {
      const assessments = await prisma.assessment.findMany({
        where: { contentId: { in: assessmentContent.map((content) => content.id) } },
        include: { _count: { select: { questions: true } } },
      });
      const idsWithQuestions = new Set(
        assessments.filter((assessment) => assessment._count.questions > 0).map((assessment) => assessment.contentId),
      );
      assessmentContent.forEach((content) => {
        if (!idsWithQuestions.has(content.id)) {
          blocking.push({
            field: `content:${content.id}`,
            message: `Module assessment "${content.title}" has no questions.`,
          });
        }
      });
    }

    const finalAssessment = course.assessments.find((assessment) => assessment.type === 'FINAL');
    if (!finalAssessment) {
      blocking.push({ field: 'finalAssessment', message: 'Create the final course assessment before publishing.' });
    } else if (finalAssessment._count.questions === 0) {
      blocking.push({ field: 'finalAssessment', message: 'The final course assessment has no questions.' });
    }

    if (course.baseStake > 0 && course.completionReward === 0 && course.commitmentBonus === 0) {
      blocking.push({
        field: 'completionReward',
        message: 'A course that charges a stake must offer at least one reward (completion or commitment).',
      });
    }

    course.commitmentOptions.forEach((option) => {
      if (option.durationDays >= course.durationDays) {
        blocking.push({
          field: `commitmentOption:${option.id}`,
          message: `Accelerated option "${option.label}" must be shorter than the ${course.durationDays}-day course duration.`,
        });
      }
      if (option.commitmentStake <= 0) {
        blocking.push({
          field: `commitmentOption:${option.id}`,
          message: `Accelerated option "${option.label}" must require a positive commitment stake.`,
        });
      }
    });

    if (blocking.length > 0) {
      throw unprocessable('The course is not ready to publish.', 'INVALID_COURSE_CONFIGURATION', { issues: blocking });
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { status: 'PUBLISHED', publishedAt: course.publishedAt ?? new Date() },
      include: { instructor: { select: instructorSelect }, _count: { select: { enrollments: true, modules: true } } },
    });

    return toCourseSummary(updated as never);
  },

  async unpublish(courseId: string, actorId: string, role: string) {
    await this.assertInstructorOwnsCourse(courseId, actorId, role);
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { status: 'DRAFT' },
      include: { instructor: { select: instructorSelect }, _count: { select: { enrollments: true, modules: true } } },
    });
    return toCourseSummary(updated as never);
  },

  async archive(courseId: string, actorId: string, role: string) {
    await this.assertInstructorOwnsCourse(courseId, actorId, role);
    const activeEnrollments = await prisma.enrollment.count({ where: { courseId, status: 'ACTIVE' } });
    if (activeEnrollments > 0) {
      throw conflict(
        `Cannot archive a course with ${activeEnrollments} active learner(s). Resolve their attempts first.`,
      );
    }
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { status: 'ARCHIVED' },
      include: { instructor: { select: instructorSelect } },
    });
    return toCourseSummary(updated as never);
  },

  async remove(courseId: string, actorId: string, role: string) {
    const course = await this.assertInstructorOwnsCourse(courseId, actorId, role);
    if (course.status === 'PUBLISHED') {
      throw conflict('Unpublish the course before deleting it.');
    }
    const enrollments = await prisma.enrollment.count({ where: { courseId } });
    if (enrollments > 0) {
      throw conflict('A course with enrolment history cannot be deleted — archive it instead.');
    }
    await prisma.course.delete({ where: { id: courseId } });
    return { id: courseId, deleted: true };
  },

  /** Raw config assertion used by the admin tooling and tests. */
  validateConfigurationOrThrow(config: CourseConfigurationInput): void {
    assertValidConfiguration(config, 'update');
  },


  async listInstructorCourses(instructorId: string) {
    const courses = await prisma.course.findMany({
      where: { instructorId },
      orderBy: { updatedAt: 'desc' },
      include: {
        instructor: { select: instructorSelect },
        _count: { select: { enrollments: true, modules: true } },
        reviews: { where: { isPublished: true }, select: { rating: true, difficultyRating: true, wouldRecommend: true } },
      },
    });
    return courses.map(toCourseSummary);
  },

  async assertCourseExists(courseId: string): Promise<Course> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw notFound('Course');
    return course;
  },
};
