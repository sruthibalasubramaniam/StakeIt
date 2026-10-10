/**
 * Zod request schemas.
 *
 * These are the API's outermost defence: every mutating endpoint parses its
 * input through one of these before a controller runs, so services can assume
 * well-formed data. Business rules (weights, balances, order) are enforced
 * separately in the service layer.
 */
import { z } from 'zod';
import { PAGINATION } from '../config/constants';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

export const uuidParam = z.string().uuid('A valid id is required.');

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(PAGINATION.maxPageSize).optional(),
});

export const idParam = z.object({ id: uuidParam });

/**
 * A course reference as it appears in a URL.
 *
 * Courses are addressable by UUID, slug or human code (`/courses/:idOrSlug`), so
 * this deliberately does NOT require a UUID — the client only ever has the slug
 * from the catalogue. Resolution happens in the service layer.
 */
export const courseRefParam = z.object({ id: z.string().trim().min(1, 'A valid id is required.').max(200) });

const optionalTrimmed = (max = 5000) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer.`)
    .transform((value) => value.trim())
    .optional();

const percent = z.coerce.number().int().min(0).max(100);
const positiveInt = z.coerce.number().int().min(0);
const atLeastOne = z.coerce.number().int().min(1);

const questionSchema = z
  .object({
    type: z.enum(['SINGLE_CHOICE', 'MULTI_CHOICE', 'TRUE_FALSE', 'SHORT_TEXT', 'CODING', 'SUBJECTIVE']).optional(),
    prompt: z.string().min(1).max(2000),
    explanation: z.string().max(2000).nullish(),
    points: z.coerce.number().int().min(1).max(100).optional(),
    orderIndex: z.coerce.number().int().min(0).optional(),
    options: z
      .array(
        z.object({
          label: z.string().min(1).max(1000),
          detail: z.string().max(1000).nullish(),
          isCorrect: z.boolean().optional(),
          orderIndex: z.coerce.number().int().min(0).optional(),
        }),
      )
      .max(10)
      .optional(),
  })
  .strict();

const answersSchema = z.record(z.union([z.array(z.string()), z.string()]));

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const registerSchema = z
  .object({
    email: z.string().email('Enter a valid email address.').max(255),
    password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
    fullName: z.string().min(2, 'Enter your full name.').max(120),
    role: z.enum(['LEARNER', 'INSTRUCTOR']).optional(),
    headline: optionalTrimmed(160),
    bio: optionalTrimmed(1000),
    expertise: z.array(z.string().max(60)).max(20).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().email('Enter a valid email address.'),
    password: z.string().min(1, 'Password is required.'),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    headline: z.string().max(160).nullish(),
    bio: z.string().max(1000).nullish(),
    avatarUrl: z.string().url().max(500).nullish().or(z.literal('')),
    expertise: z.array(z.string().max(60)).max(20).optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(128),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Courses                                                                     */
/* -------------------------------------------------------------------------- */

export const courseListQuery = paginationQuery.extend({
  q: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  difficulty: z.string().max(30).optional(),
  status: z.string().max(30).optional(),
  instructorId: z.string().uuid().optional(),
  tags: z.string().max(300).optional(),
  sort: z.enum(['newest', 'popular', 'rating', 'reputation', 'stake', 'duration', 'title']).optional(),
  includeUnpublished: z.enum(['true', 'false']).optional(),
});

export const createCourseSchema = z
  .object({
    title: z.string().min(4, 'Course title must be at least 4 characters.').max(160),
    shortDescription: z.string().min(10, 'Add a short description of at least 10 characters.').max(280),
    description: z.string().min(20, 'Add a fuller description of at least 20 characters.').max(6000),
    category: z.string().min(2).max(120),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).optional(),
    coverImageUrl: z.string().url().max(500).nullish().or(z.literal('')),
    tags: z.array(z.string().max(40)).max(15).optional(),
    baseStake: positiveInt.optional(),
    completionReward: positiveInt.optional(),
    commitmentBonus: positiveInt.optional(),
    performanceBonus: positiveInt.optional(),
    performanceThreshold: percent.optional(),
    durationDays: atLeastOne.optional(),
    gracePeriodHours: positiveInt.optional(),
    moduleWeight: percent.optional(),
    finalTestWeight: percent.optional(),
    minFinalTestScore: percent.nullish(),
    moduleQuizWeight: percent.optional(),
    moduleAssessmentWeight: percent.optional(),
    maxAttempts: atLeastOne.optional(),
    requiredWatchPercent: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const updateCourseSchema = createCourseSchema.partial();

export const moduleSchema = z
  .object({
    title: z.string().min(2).max(200),
    summary: optionalTrimmed(1000),
    isRequired: z.boolean().optional(),
  })
  .strict();

export const reorderSchema = z
  .object({
    orderedIds: z.array(uuidParam).min(1, 'Provide at least one id.'),
  })
  .strict();

export const contentSchema = z
  .object({
    type: z.enum(['VIDEO', 'READING', 'QUIZ', 'MODULE_ASSESSMENT', 'CODING', 'SUBJECTIVE']),
    title: z.string().min(2).max(200),
    description: optionalTrimmed(2000),
    isRequired: z.boolean().optional(),
    estimatedMinutes: positiveInt.nullish(),
    videoUrl: z.string().url().max(1000).nullish().or(z.literal('')),
    durationSeconds: positiveInt.nullish(),
    requiredWatchPercent: percent.nullish(),
    readingBody: z.string().max(100_000).nullish(),
    requiresComprehensionCheck: z.boolean().optional(),
    comprehensionPrompt: optionalTrimmed(1000),
    comprehensionAnswer: optionalTrimmed(500),
    passingScore: percent.optional(),
    maxAttempts: atLeastOne.nullish(),
    timeLimitMinutes: atLeastOne.nullish(),
  })
  .strict();

export const updateContentSchema = contentSchema.partial().omit({ type: true });

export const quizSettingsSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    description: optionalTrimmed(2000),
    passingScore: percent.optional(),
    maxAttempts: atLeastOne.nullish(),
    timeLimitMinutes: atLeastOne.nullish(),
    shuffleQuestions: z.boolean().optional(),
  })
  .strict();

export const questionsSchema = z
  .object({
    questions: z.array(questionSchema).max(200),
  })
  .strict();

export const finalAssessmentSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    description: optionalTrimmed(2000),
    passingScore: percent.optional(),
    maxAttempts: atLeastOne.nullish(),
    timeLimitMinutes: atLeastOne.nullish(),
  })
  .strict();

export const commitmentOptionsSchema = z
  .object({
    options: z
      .array(
        z.object({
          label: z.string().min(2).max(120),
          durationDays: atLeastOne,
          commitmentStake: atLeastOne,
          commitmentBonus: positiveInt,
          isDefault: z.boolean().optional(),
        }),
      )
      .max(6),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Enrolment & learning                                                        */
/* -------------------------------------------------------------------------- */

export const enrollSchema = z
  .object({
    committedStake: positiveInt.optional(),
    accelerated: z.boolean().optional(),
    commitmentOptionId: uuidParam.nullish(),
  })
  .strict();

export const videoProgressSchema = z
  .object({
    positionSeconds: z.coerce.number().min(0),
    fromSeconds: z.coerce.number().min(0).optional(),
    elapsedRealSeconds: z.coerce.number().min(0).max(3600).optional(),
    durationSeconds: z.coerce.number().min(0).optional(),
    playbackRate: z.coerce.number().min(1).max(3).optional(),
    activeSeconds: z.coerce.number().min(0).max(600).optional(),
  })
  .strict();

export const readingProgressSchema = z
  .object({
    scrollPercent: z.coerce.number().min(0).max(100).optional(),
    reachedEnd: z.boolean().optional(),
    activeSeconds: z.coerce.number().min(0).max(3600).optional(),
  })
  .strict();

export const comprehensionSchema = z
  .object({
    answer: z.string().min(1, 'Provide an answer.').max(500),
  })
  .strict();

export const submissionSchema = z
  .object({
    answers: answersSchema,
    timeSpentSeconds: z.coerce.number().min(0).max(86_400).optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Wallet, stakes, reviews                                                     */
/* -------------------------------------------------------------------------- */

export const transactionQuery = paginationQuery.extend({
  type: z.string().max(200).optional(),
  referenceType: z.string().max(60).optional(),
});

export const stakeListQuery = paginationQuery.extend({
  status: z.string().max(60).optional(),
  courseId: z.string().uuid().optional(),
});

export const reviewSchema = z
  .object({
    rating: z.coerce.number().int().min(1, 'Choose a rating from 1 to 5.').max(5),
    difficultyRating: z.coerce.number().int().min(1).max(5).nullish(),
    wouldRecommend: z.boolean().optional(),
    reviewText: z.string().max(4000).nullish(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Analytics & admin                                                           */
/* -------------------------------------------------------------------------- */

export const analyticsQuery = paginationQuery.extend({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const adminUserQuery = paginationQuery.extend({
  role: z.string().max(30).optional(),
  q: z.string().max(200).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', 'created']).optional(),
});

export const adminUpdateUserSchema = z
  .object({
    role: z.enum(['LEARNER', 'INSTRUCTOR', 'ADMIN']).optional(),
    isActive: z.boolean().optional(),
    fullName: z.string().min(2).max(120).optional(),
    headline: z.string().max(160).nullish(),
  })
  .strict();

export const adminGrantPointsSchema = z
  .object({
    amount: z.coerce.number().int().refine((value) => value !== 0, 'Amount cannot be zero.'),
    reason: z.string().min(4, 'Provide a reason for the adjustment.').max(500),
  })
  .strict();

export const adminPoolAdjustSchema = z
  .object({
    amount: z.coerce.number().int().refine((value) => value !== 0, 'Amount cannot be zero.'),
    reason: z.string().min(4).max(500),
  })
  .strict();

export const adminExtendDeadlineSchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365),
    reason: z.string().min(4).max(500),
  })
  .strict();

export const adminReleaseStakesSchema = z
  .object({
    reason: z.string().min(4).max(500),
  })
  .strict();

export const adminModerateReviewSchema = z
  .object({
    isFlagged: z.boolean().optional(),
    flagReason: z.string().max(500).nullish(),
    isPublished: z.boolean().optional(),
  })
  .strict();

export const adminBadgeSchema = z
  .object({
    tier: z.enum(['NONE', 'BRONZE', 'SILVER', 'GOLD']),
    notes: z.string().max(500).optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export const notificationQuery = paginationQuery.extend({
  unreadOnly: z.enum(['true', 'false']).optional(),
});

export const notificationParam = z.object({ id: uuidParam });

/* -------------------------------------------------------------------------- */
/* Content nested params                                                       */
/* -------------------------------------------------------------------------- */

export const attemptContentParam = z.object({
  enrollmentId: uuidParam.optional(),
  attemptId: uuidParam,
  contentId: uuidParam,
});

export const attemptQuizParam = z.object({
  enrollmentId: uuidParam.optional(),
  attemptId: uuidParam,
  quizId: uuidParam,
});

export const attemptAssessmentParam = z.object({
  enrollmentId: uuidParam.optional(),
  attemptId: uuidParam,
  assessmentId: uuidParam,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
