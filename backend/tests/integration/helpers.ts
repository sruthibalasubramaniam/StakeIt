import type { Express } from 'express';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashPassword } from '../../src/services/tokenService';
import { WalletService } from '../../src/services/walletService';

/**
 * Integration-test harness.
 *
 * The suite drives the real Express app against a real PostgreSQL database —
 * there is no service mocking, because the point of these tests is to prove the
 * transaction boundaries and the sequential-locking rules actually hold.
 *
 * PERFORMANCE NOTE: this suite is frequently pointed at a *remote* database
 * (Supabase) where a single round-trip costs ~1.3 s. Every avoidable round-trip
 * is therefore removed:
 *   - `resetDatabase` issues one TRUNCATE instead of ~24 sequential DELETEs;
 *   - `createMinimalCourse` builds the whole course in two round-trips using
 *     nested creates plus one batched transaction, instead of ~30 writes and a
 *     transaction per question.
 * That is why the fixtures below look "flat" rather than step-by-step.
 *
 * When no database is reachable the suites skip instead of failing, so
 * `npm test` still gives a meaningful result on a machine without PostgreSQL.
 */
export const TEST_PASSWORD = 'Password123';

/**
 * Per-test budget for the database-backed suite.
 *
 * Measured against the reference remote database: ~210 ms per SQL statement and
 * 16–24 statements per API request, i.e. 3–6 s per request and 30–60 s for one
 * end-to-end test. The allowance exists so ordinary remote latency cannot
 * masquerade as a failure. It does not mask logic errors — those still fail,
 * they just take longer to report — and the unit suite covers the same rules
 * with no database at all, so a slow integration run never hides a regression.
 *
 * Running against a local PostgreSQL drops this to a few seconds; the large
 * value is purely a remote-database allowance.
 */
export const INTEGRATION_TEST_TIMEOUT_MS = 120_000;

/** Tables truncated between tests, in one statement. */
const TRUNCATE_TABLES = [
  'notifications',
  'reward_pool_transactions',
  'wallet_transactions',
  'stakes',
  'content_progress',
  'quiz_attempts',
  'assessment_submissions',
  'course_attempts',
  'enrollments',
  'course_reviews',
  'instructor_badges',
  'assessment_options',
  'assessment_questions',
  'assessments',
  'quiz_options',
  'quiz_questions',
  'quizzes',
  'module_contents',
  'modules',
  'course_commitment_options',
  'courses',
  'wallets',
  'users',
  'reward_pool',
].join(', ');

let cachedAvailability: boolean | null = null;

/**
 * Probes the database with a few attempts: remote endpoints occasionally fail a
 * single connect (address-family/DNS hiccups), and a transient failure must not
 * silently skip the whole suite.
 */
export async function isDatabaseAvailable(attempts = 3): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      cachedAvailability = true;
      return true;
    } catch {
      // Retry — a single failed connect says nothing about availability.
    }
  }

  cachedAvailability = false;
  return false;
}

export function buildTestApp(): Express {
  return createApp();
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  role: Role;
}

export async function createTestUser(params: {
  email: string;
  role: Role;
  fullName?: string;
  grant?: number;
}): Promise<TestUser> {
  const user = await prisma.user.create({
    data: {
      email: params.email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: params.role,
      fullName: params.fullName ?? params.email.split('@')[0]!,
    },
  });

  await WalletService.getOrCreateWallet(prisma, user.id);
  if (params.grant && params.grant > 0) {
    await WalletService.credit(prisma, {
      userId: user.id,
      amount: params.grant,
      type: 'SIGNUP_GRANT',
      description: 'Test grant',
      referenceType: 'USER',
      referenceId: user.id,
    });
  }

  const userWithPassword = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(userWithPassword.passwordHash).toBeTruthy();

  return { id: user.id, email: user.email, token: '', role: params.role };
}

/** Signs in through the API so the token is exactly what a client would get. */
export async function login(app: Express, email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data.accessToken as string;
}

export async function registerAndLogin(
  app: Express,
  params: { email: string; role: 'LEARNER' | 'INSTRUCTOR'; fullName?: string },
): Promise<TestUser> {
  const registration = await request(app)
    .post('/api/auth/register')
    .send({ email: params.email, password: TEST_PASSWORD, fullName: params.fullName ?? 'Test Person', role: params.role });

  if (registration.status !== 201) {
    throw new Error(`Registration failed: ${registration.status} ${JSON.stringify(registration.body)}`);
  }

  const token = registration.body.data.accessToken as string;
  const userId = registration.body.data.user.id as string;
  return { id: userId, email: params.email, token, role: params.role };
}

export interface MinimalCourse {
  courseId: string;
  moduleOneVideoContentId: string;
  moduleOneQuizId: string;
  moduleOneQuizQuestionIds: string[];
  moduleOneQuizCorrectOptions: Record<string, string>;
  moduleOneAssessmentId: string;
  moduleOneAssessmentCorrectOptions: Record<string, string>;
  moduleTwoVideoContentId: string;
  finalAssessmentId: string;
  finalCorrectOptions: Record<string, string>;
  durationDays: number;
  baseStake: number;
}

/**
 * Nested-create payload for a single auto-gradable question.
 *
 * Declared structurally (rather than as Prisma's `QuizQuestionCreateWithoutQuizInput`)
 * so the same object can be nested under either a quiz or an assessment — the
 * two Prisma input types are structurally identical here but nominally distinct.
 */
interface ChoiceQuestionData {
  type: 'SINGLE_CHOICE';
  prompt: string;
  points: number;
  orderIndex: number;
  options: { create: Array<{ label: string; isCorrect: boolean; orderIndex: number }> };
}

function choiceQuestion(index: number): ChoiceQuestionData {
  return {
    type: 'SINGLE_CHOICE',
    prompt: `Question ${index + 1}`,
    points: 10,
    orderIndex: index,
    options: {
      create: [
        { label: 'Correct', isCorrect: true, orderIndex: 0 },
        { label: 'Incorrect', isCorrect: false, orderIndex: 1 },
      ],
    },
  };
}

function questionCount(count: number): ChoiceQuestionData[] {
  return Array.from({ length: count }, (_, index) => choiceQuestion(index));
}

/** Extracts `questionId -> correctOptionId` from a fetched question tree. */
function correctOptionsFrom(questions: Array<{ id: string; options: Array<{ id: string; isCorrect: boolean }> }>) {
  const map: Record<string, string> = {};
  for (const question of questions) {
    const correct = question.options.find((option) => option.isCorrect);
    if (correct) map[question.id] = correct.id;
  }
  return map;
}

/**
 * Creates a two-module course.
 *
 * Round-trip budget: 2.
 *   1. the whole module/content/quiz/question tree in one nested create;
 *   2. the three assessments (module 1, module 2, final) in one batched
 *      transaction — they need content ids, which only exist after step 1.
 */
export async function createMinimalCourse(
  instructorId: string,
  overrides: Partial<{
    baseStake: number;
    completionReward: number;
    maxAttempts: number;
    minFinalTestScore: number | null;
  }> = {},
): Promise<MinimalCourse> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const course = await prisma.course.create({
    data: {
      code: `TST-${Math.floor(Math.random() * 9000) + 1000}`,
      slug: `test-course-${suffix}`,
      title: 'Integration Test Course',
      shortDescription: 'A course created by the integration suite.',
      description: 'Generated fixture used to verify sequential unlocking and settlement behaviour.',
      category: 'Testing',
      difficulty: 'INTERMEDIATE',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      instructorId,
      baseStake: overrides.baseStake ?? 100,
      completionReward: overrides.completionReward ?? 50,
      commitmentBonus: 40,
      performanceBonus: 30,
      performanceThreshold: 85,
      durationDays: 30,
      gracePeriodHours: 24,
      moduleWeight: 70,
      finalTestWeight: 30,
      moduleQuizWeight: 40,
      moduleAssessmentWeight: 60,
      minFinalTestScore: overrides.minFinalTestScore ?? null,
      maxAttempts: overrides.maxAttempts ?? 3,
      requiredWatchPercent: 90,
      modules: {
        create: [
          {
            title: 'Module 1',
            orderIndex: 0,
            isRequired: true,
            contents: {
              create: [
                {
                  type: 'VIDEO',
                  title: 'Module 1 Video',
                  orderIndex: 0,
                  isRequired: true,
                  videoUrl: 'https://example.com/demo.mp4',
                  durationSeconds: 600,
                },
                {
                  type: 'QUIZ',
                  title: 'Module 1 Quiz',
                  orderIndex: 1,
                  isRequired: true,
                  quiz: {
                    create: {
                      title: 'Module 1 Quiz',
                      passingScore: 70,
                      questions: { create: questionCount(4) },
                    },
                  },
                },
                {
                  type: 'MODULE_ASSESSMENT',
                  title: 'Module 1 Assessment',
                  orderIndex: 2,
                  isRequired: true,
                },
              ],
            },
          },
          {
            title: 'Module 2',
            orderIndex: 1,
            isRequired: true,
            contents: {
              create: [
                {
                  type: 'VIDEO',
                  title: 'Module 2 Video',
                  orderIndex: 0,
                  isRequired: true,
                  videoUrl: 'https://example.com/demo2.mp4',
                  durationSeconds: 600,
                },
                {
                  type: 'MODULE_ASSESSMENT',
                  title: 'Module 2 Assessment',
                  orderIndex: 1,
                  isRequired: true,
                },
              ],
            },
          },
        ],
      },
    },
    include: {
      modules: {
        orderBy: { orderIndex: 'asc' },
        include: {
          contents: {
            orderBy: { orderIndex: 'asc' },
            include: {
              quiz: { include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } } },
            },
          },
        },
      },
    },
  });

  const moduleOne = course.modules[0]!;
  const moduleTwo = course.modules[1]!;
  const moduleOneVideo = moduleOne.contents[0]!;
  const moduleOneQuizContent = moduleOne.contents[1]!;
  const moduleOneAssessmentContent = moduleOne.contents[2]!;
  const moduleTwoVideo = moduleTwo.contents[0]!;
  const moduleTwoAssessmentContent = moduleTwo.contents[1]!;

  const moduleOneQuiz = moduleOneQuizContent.quiz!;

  const [moduleOneAssessment, moduleTwoAssessment, finalAssessment] = await prisma.$transaction([
    prisma.assessment.create({
      data: {
        courseId: course.id,
        moduleId: moduleOne.id,
        contentId: moduleOneAssessmentContent.id,
        type: 'MODULE',
        title: 'Module 1 Assessment',
        passingScore: 70,
        questions: { create: questionCount(4) },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } },
    }),
    prisma.assessment.create({
      data: {
        courseId: course.id,
        moduleId: moduleTwo.id,
        contentId: moduleTwoAssessmentContent.id,
        type: 'MODULE',
        title: 'Module 2 Assessment',
        passingScore: 70,
        questions: { create: questionCount(4) },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } },
    }),
    prisma.assessment.create({
      data: {
        courseId: course.id,
        type: 'FINAL',
        title: 'Final Test',
        passingScore: 70,
        maxAttempts: 3,
        questions: { create: questionCount(3) },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: true } } },
    }),
  ]);

  return {
    courseId: course.id,
    moduleOneVideoContentId: moduleOneVideo.id,
    moduleOneQuizId: moduleOneQuiz.id,
    moduleOneQuizQuestionIds: moduleOneQuiz.questions.map((question) => question.id),
    moduleOneQuizCorrectOptions: correctOptionsFrom(moduleOneQuiz.questions),
    moduleOneAssessmentId: moduleOneAssessment.id,
    moduleOneAssessmentCorrectOptions: correctOptionsFrom(moduleOneAssessment.questions),
    moduleTwoVideoContentId: moduleTwoVideo.id,
    finalAssessmentId: finalAssessment.id,
    finalCorrectOptions: correctOptionsFrom(finalAssessment.questions),
    durationDays: course.durationDays,
    baseStake: course.baseStake,
  };
}

/** Loads the module-2 assessment id (not tracked in the fixture's simple shape). */
export async function getModuleTwoAssessmentId(courseId: string): Promise<string> {
  const assessment = await prisma.assessment.findFirstOrThrow({
    where: { courseId, type: 'MODULE', module: { orderIndex: 1 } },
  });
  return assessment.id;
}

export async function loadCorrectOptions(assessmentId: string): Promise<Record<string, string>> {
  const questions = await prisma.assessmentQuestion.findMany({
    where: { assessmentId },
    include: { options: true },
  });
  const map: Record<string, string> = {};
  for (const question of questions) {
    const correct = question.options.find((option) => option.isCorrect);
    if (correct) map[question.id] = correct.id;
  }
  return map;
}

export async function getWallet(userId: string) {
  return prisma.wallet.findUniqueOrThrow({ where: { userId } });
}

/**
 * Empties every table in one statement.
 *
 * TRUNCATE … CASCADE also resets dependent rows and sequences, and is a single
 * round-trip — important when the target database is remote.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`);
}
