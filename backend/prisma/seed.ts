/**
 * Stake It — demo seed.
 *
 * Everything here is clearly fake data for a demo/semester project. All point
 * movements are produced by the REAL services (WalletService, EnrollmentService,
 * CompletionService, StakeService, ReputationService) rather than by writing rows
 * directly, so the seeded database is ledger-consistent: balances always equal
 * the sum of their transactions, and forfeited stakes really do sit in the pool.
 *
 * Run with:  npm run db:seed
 */
import { PrismaClient, type Difficulty, type Role } from '@prisma/client';
import { hashPassword } from '../src/services/tokenService';
import { WalletService } from '../src/services/walletService';
import { EnrollmentService } from '../src/services/enrollmentService';
import { CompletionService } from '../src/services/completionService';
import { StakeService } from '../src/services/stakeService';
import { RewardPoolService } from '../src/services/rewardPoolService';
import { ReputationService } from '../src/services/reputationService';
import { NotificationService } from '../src/services/notificationService';
import { addDays, addHours } from '../src/utils/date';

const prisma = new PrismaClient();

/**
 * A lesson video reference.
 *
 * `seconds` is the video's *real* duration. It is stored on the content row and
 * is what the valid-watch rule measures against, so it has to be right — a
 * duration that is too long makes a lesson impossible to complete, and one that
 * is too short lets a learner finish without watching.
 *
 * These are public YouTube videos, embedded by the client through the IFrame
 * player (a YouTube page cannot be played by a `<video>` element). To use your
 * own material, point `url` at a YouTube link or any public MP4 — Supabase
 * Storage is wired up in `lib/supabase.ts` for uploaded assets.
 */
interface VideoSeed {
  url: string;
  seconds: number;
}

const DEMO_PASSWORD = 'Password123';

/* -------------------------------------------------------------------------- */
/* Wipe                                                                        */
/* -------------------------------------------------------------------------- */

async function reset(): Promise<void> {
  // Dependency-ordered deletion (children first).
  await prisma.notification.deleteMany();
  await prisma.rewardPoolTransaction.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.stake.deleteMany();
  await prisma.contentProgress.deleteMany();
  await prisma.quizAttempt.deleteMany();
  await prisma.assessmentSubmission.deleteMany();
  await prisma.courseAttempt.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.courseReview.deleteMany();
  await prisma.instructorBadge.deleteMany();
  await prisma.assessmentOption.deleteMany();
  await prisma.assessmentQuestion.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.quizOption.deleteMany();
  await prisma.quizQuestion.deleteMany();
  await prisma.quiz.deleteMany();
  await prisma.moduleContent.deleteMany();
  await prisma.module.deleteMany();
  await prisma.courseCommitmentOption.deleteMany();
  await prisma.course.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rewardPool.deleteMany();
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

interface SeedUserInput {
  email: string;
  fullName: string;
  role: Role;
  headline?: string;
  bio?: string;
  expertise?: string[];
  grant?: number;
}

async function createUser(input: SeedUserInput): Promise<{ id: string; email: string; fullName: string }> {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: input.role,
      fullName: input.fullName,
      headline: input.headline ?? null,
      bio: input.bio ?? null,
      expertise: input.expertise ?? [],
      lastLoginAt: new Date(),
    },
  });

  const wallet = await WalletService.getOrCreateWallet(prisma, user.id);
  const grant = input.grant ?? 1500;
  if (grant > 0) {
    await WalletService.credit(prisma, {
      userId: user.id,
      amount: grant,
      type: 'SIGNUP_GRANT',
      description: `Welcome grant of ${grant} points`,
      referenceType: 'USER',
      referenceId: user.id,
    });
  }
  void wallet;

  return { id: user.id, email: user.email, fullName: user.fullName };
}

/* -------------------------------------------------------------------------- */
/* Course construction helpers                                                 */
/* -------------------------------------------------------------------------- */

interface QuestionSeed {
  prompt: string;
  explanation: string;
  options: Array<{ label: string; detail?: string; isCorrect?: boolean }>;
}

function choiceQuestion(prompt: string, explanation: string, correct: string, wrong: Array<[string, string]>): QuestionSeed {
  return {
    prompt,
    explanation,
    options: [
      { label: correct, isCorrect: true },
      ...wrong.map(([label, detail]) => ({ label, detail })),
    ],
  };
}

interface ModuleSeed {
  title: string;
  summary: string;
  videoTitle: string;
  videoDescription: string;
  readingTitle: string;
  readingBody: string;
  readingPrompt?: string;
  readingAnswer?: string;
  quizTitle: string;
  quizQuestions: QuestionSeed[];
  assessmentTitle: string;
  assessmentQuestions: QuestionSeed[];
}

interface CourseSeed {
  title: string;
  code: string;
  category: string;
  difficulty: Difficulty;
  shortDescription: string;
  description: string;
  tags: string[];
  durationDays: number;
  gracePeriodHours: number;
  baseStake: number;
  completionReward: number;
  commitmentBonus: number;
  performanceBonus: number;
  performanceThreshold: number;
  moduleWeight: number;
  finalTestWeight: number;
  moduleQuizWeight: number;
  moduleAssessmentWeight: number;
  minFinalTestScore: number | null;
  maxAttempts: number;
  requiredWatchPercent: number;
  /**
   * Lesson videos for this course, consumed one per module (wrapping when a
   * course has more modules than videos).
   */
  videos: VideoSeed[];
  commitmentOptions: Array<{ label: string; durationDays: number; commitmentStake: number; commitmentBonus: number; isDefault: boolean }>;
  modules: ModuleSeed[];
  finalTitle: string;
  finalQuestions: QuestionSeed[];
  instructorIndex: number;
}

async function createCourse(seed: CourseSeed, instructorId: string): Promise<string> {
  const course = await prisma.course.create({
    data: {
      code: seed.code,
      slug: seed.title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-'),
      title: seed.title,
      shortDescription: seed.shortDescription,
      description: seed.description,
      category: seed.category,
      difficulty: seed.difficulty,
      tags: seed.tags,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      instructorId,
      baseStake: seed.baseStake,
      completionReward: seed.completionReward,
      commitmentBonus: seed.commitmentBonus,
      performanceBonus: seed.performanceBonus,
      performanceThreshold: seed.performanceThreshold,
      durationDays: seed.durationDays,
      gracePeriodHours: seed.gracePeriodHours,
      moduleWeight: seed.moduleWeight,
      finalTestWeight: seed.finalTestWeight,
      moduleQuizWeight: seed.moduleQuizWeight,
      moduleAssessmentWeight: seed.moduleAssessmentWeight,
      minFinalTestScore: seed.minFinalTestScore,
      maxAttempts: seed.maxAttempts,
      requiredWatchPercent: seed.requiredWatchPercent,
      commitmentOptions: {
        create: seed.commitmentOptions.map((option, index) => ({
          label: option.label,
          durationDays: option.durationDays,
          commitmentStake: option.commitmentStake,
          commitmentBonus: option.commitmentBonus,
          isDefault: option.isDefault,
          orderIndex: index,
        })),
      },
    },
  });

  for (const [moduleIndex, moduleSeed] of seed.modules.entries()) {
    const module = await prisma.module.create({
      data: {
        courseId: course.id,
        title: moduleSeed.title,
        summary: moduleSeed.summary,
        orderIndex: moduleIndex,
        isRequired: true,
      },
    });

    // 1. Video — the course supplies one video per module, cycling if shorter.
    const video = seed.videos[moduleIndex % seed.videos.length]!;

    await prisma.moduleContent.create({
      data: {
        moduleId: module.id,
        type: 'VIDEO',
        title: `Video: ${moduleSeed.videoTitle}`,
        description: moduleSeed.videoDescription,
        orderIndex: 0,
        isRequired: true,
        estimatedMinutes: Math.max(1, Math.round(video.seconds / 60)),
        videoUrl: video.url,
        durationSeconds: video.seconds,
      },
    });

    // 2. Reading (with a comprehension check on the first module of each course)
    await prisma.moduleContent.create({
      data: {
        moduleId: module.id,
        type: 'READING',
        title: `Reading: ${moduleSeed.readingTitle}`,
        description: 'Reference notes for this module.',
        orderIndex: 1,
        isRequired: true,
        estimatedMinutes: 15,
        readingBody: moduleSeed.readingBody,
        requiresComprehensionCheck: Boolean(moduleSeed.readingAnswer),
        comprehensionPrompt: moduleSeed.readingPrompt ?? null,
        comprehensionAnswer: moduleSeed.readingAnswer ?? null,
      },
    });

    // 3. Quiz
    const quizContent = await prisma.moduleContent.create({
      data: {
        moduleId: module.id,
        type: 'QUIZ',
        title: `Quiz: ${moduleSeed.quizTitle}`,
        description: 'Auto-graded checkpoint.',
        orderIndex: 2,
        isRequired: true,
        estimatedMinutes: 10,
      },
    });
    await prisma.quiz.create({
      data: {
        contentId: quizContent.id,
        title: quizContent.title,
        passingScore: 70,
        questions: {
          create: moduleSeed.quizQuestions.map((question, questionIndex) => ({
            type: 'SINGLE_CHOICE',
            prompt: question.prompt,
            explanation: question.explanation,
            points: 10,
            orderIndex: questionIndex,
            options: {
              create: question.options.map((option, optionIndex) => ({
                label: option.label,
                detail: option.detail ?? null,
                isCorrect: option.isCorrect ?? false,
                orderIndex: optionIndex,
              })),
            },
          })),
        },
      },
    });

    // 4. Module assessment
    const assessmentContent = await prisma.moduleContent.create({
      data: {
        moduleId: module.id,
        type: 'MODULE_ASSESSMENT',
        title: `Module Assessment: ${moduleSeed.assessmentTitle}`,
        description: 'Graded gate — the next module unlocks when this passes.',
        orderIndex: 3,
        isRequired: true,
        estimatedMinutes: 25,
      },
    });
    await prisma.assessment.create({
      data: {
        courseId: course.id,
        moduleId: module.id,
        contentId: assessmentContent.id,
        type: 'MODULE',
        title: assessmentContent.title,
        passingScore: 70,
        maxAttempts: 3,
        questions: {
          create: moduleSeed.assessmentQuestions.map((question, questionIndex) => ({
            type: 'SINGLE_CHOICE',
            prompt: question.prompt,
            explanation: question.explanation,
            points: 10,
            orderIndex: questionIndex,
            options: {
              create: question.options.map((option, optionIndex) => ({
                label: option.label,
                detail: option.detail ?? null,
                isCorrect: option.isCorrect ?? false,
                orderIndex: optionIndex,
              })),
            },
          })),
        },
      },
    });
  }

  // Final course assessment
  await prisma.assessment.create({
    data: {
      courseId: course.id,
      type: 'FINAL',
      title: seed.finalTitle,
      description: 'Unlocks once every required module assessment has passed.',
      passingScore: 70,
      maxAttempts: seed.minFinalTestScore ? 2 : 3,
      questions: {
        create: seed.finalQuestions.map((question, questionIndex) => ({
          type: 'SINGLE_CHOICE',
          prompt: question.prompt,
          explanation: question.explanation,
          points: 10,
          orderIndex: questionIndex,
          options: {
            create: question.options.map((option, optionIndex) => ({
              label: option.label,
              detail: option.detail ?? null,
              isCorrect: option.isCorrect ?? false,
              orderIndex: optionIndex,
            })),
          },
        })),
      },
    },
  });

  return course.id;
}

/* -------------------------------------------------------------------------- */
/* Simulation helpers — drive real services so the ledger stays consistent     */
/* -------------------------------------------------------------------------- */

interface CourseShape {
  courseId: string;
  contentIds: string[];
  quizIds: string[];
  assessmentIds: string[];
  moduleAssessmentIds: string[];
  finalAssessmentId: string;
}

async function loadShape(courseId: string): Promise<CourseShape> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: {
      modules: {
        include: {
          contents: { include: { quiz: true, assessment: true } },
        },
      },
      assessments: true,
    },
  });

  const contents = course.modules.flatMap((module) => module.contents);

  return {
    courseId,
    contentIds: contents.map((content) => content.id),
    quizIds: contents.map((content) => content.quiz?.id).filter((id): id is string => Boolean(id)),
    assessmentIds: contents.map((content) => content.assessment?.id).filter((id): id is string => Boolean(id)),
    moduleAssessmentIds: contents
      .filter((content) => content.type === 'MODULE_ASSESSMENT')
      .map((content) => content.assessment?.id)
      .filter((id): id is string => Boolean(id)),
    finalAssessmentId: course.assessments.find((assessment) => assessment.type === 'FINAL')!.id,
  };
}

/** Marks content complete with realistic watch/reading telemetry. */
async function completeContent(
  attemptId: string,
  userId: string,
  contentId: string,
  contentType: string,
  durationSeconds: number,
): Promise<void> {
  await prisma.contentProgress.create({
    data: {
      attemptId,
      userId,
      contentId,
      status: 'COMPLETED',
      completedAt: new Date(),
      firstAccessedAt: new Date(),
      activeSeconds: contentType === 'VIDEO' ? 720 : 600,
      lastPositionSeconds: contentSeconds(contentType, durationSeconds),
      watchedSeconds: contentType === 'VIDEO' ? durationSeconds : 0,
      validWatchPercent: contentType === 'VIDEO' ? 96 : 0,
      watchedSegments: contentType === 'VIDEO' ? ([[0, durationSeconds]] as unknown as object) : ([] as unknown as object),
      readingReachedEnd: contentType === 'READING',
      comprehensionPassed: contentType === 'READING' ? true : null,
    },
  });
}

function contentSeconds(contentType: string, durationSeconds: number): number {
  return contentType === 'VIDEO' ? durationSeconds : 100;
}

/** Creates a passing quiz attempt and completes the content row. */
async function passQuiz(quizId: string, attemptId: string, userId: string, percentage: number, attemptNumber = 1) {
  const quiz = await prisma.quiz.findUniqueOrThrow({
    where: { id: quizId },
    include: { questions: { include: { options: true } }, content: true },
  });

  const maxScore = quiz.questions.reduce((sum, question) => sum + question.points, 0);
  const score = Math.round((percentage / 100) * maxScore);

  // Answer key: pick the correct option for a proportion of the questions so
  // the stored percentage matches what a real attempt would produce.
  const correctCount = Math.round((percentage / 100) * quiz.questions.length);
  const answers: Record<string, string[]> = {};
  quiz.questions.forEach((question, index) => {
    const correct = question.options.find((option) => option.isCorrect);
    const wrong = question.options.find((option) => !option.isCorrect);
    const pick = index < correctCount ? correct : wrong;
    if (pick) answers[question.id] = [pick.id];
  });

  await prisma.quizAttempt.create({
    data: {
      quizId,
      userId,
      attemptId,
      attemptNumber,
      answers: answers as never,
      score,
      maxScore,
      percentage,
      passed: percentage >= quiz.passingScore,
      status: 'AUTO_GRADED',
      timeSpentSeconds: 420,
      submittedAt: new Date(),
      gradedAt: new Date(),
    },
  });

  await completeContent(attemptId, userId, quiz.contentId, 'QUIZ', 0);
}

async function passAssessment(
  assessmentId: string,
  attemptId: string,
  userId: string,
  percentage: number,
  attemptNumber = 1,
) {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { questions: { include: { options: true } }, content: true },
  });

  const maxScore = assessment.questions.reduce((sum, question) => sum + question.points, 0);
  const score = Math.round((percentage / 100) * maxScore);
  const correctCount = Math.round((percentage / 100) * assessment.questions.length);

  const answers: Record<string, string[]> = {};
  assessment.questions.forEach((question, index) => {
    const correct = question.options.find((option) => option.isCorrect);
    const wrong = question.options.find((option) => !option.isCorrect);
    const pick = index < correctCount ? correct : wrong;
    if (pick) answers[question.id] = [pick.id];
  });

  await prisma.assessmentSubmission.create({
    data: {
      assessmentId,
      userId,
      attemptId,
      attemptNumber,
      answers: answers as never,
      score,
      maxScore,
      percentage,
      passed: percentage >= assessment.passingScore,
      status: 'AUTO_GRADED',
      timeSpentSeconds: 900,
      gradedAt: new Date(),
    },
  });

  if (assessment.contentId) {
    await completeContent(attemptId, userId, assessment.contentId, assessment.type, 0);
  }
}

/** Completes the whole curriculum for an attempt, then settles it. */
async function completeCourseFully(
  attemptId: string,
  userId: string,
  shape: CourseShape,
  scores: { quiz: number; moduleAssessment: number; final: number },
) {
  const contents = await prisma.moduleContent.findMany({
    where: { id: { in: shape.contentIds } },
    select: { id: true, type: true, durationSeconds: true },
  });

  for (const content of contents) {
    if (content.type === 'VIDEO') {
      // Each lesson has its own video length, so the simulated watch progress
      // must use that lesson's duration rather than a single shared constant.
      await completeContent(attemptId, userId, content.id, 'VIDEO', content.durationSeconds ?? 0);
    } else if (content.type === 'READING') {
      await completeContent(attemptId, userId, content.id, 'READING', 0);
    }
  }

  for (const quizId of shape.quizIds) {
    await passQuiz(quizId, attemptId, userId, scores.quiz);
  }

  for (const assessmentId of shape.moduleAssessmentIds) {
    await passAssessment(assessmentId, attemptId, userId, scores.moduleAssessment);
  }

  await passAssessment(shape.finalAssessmentId, attemptId, userId, scores.final);

  return CompletionService.settleSuccessfulCompletion(attemptId);
}

/* -------------------------------------------------------------------------- */
/* Course catalogue                                                            */
/* -------------------------------------------------------------------------- */

const COURSES: CourseSeed[] = [
  {
    title: 'Full-Stack TypeScript & Architecture',
    code: 'DEV-301',
    videos: [
      { url: 'https://www.youtube.com/watch?v=_QAbWfcCaKc', seconds: 2182 },
      { url: 'https://www.youtube.com/watch?v=-SLxfsrTiSU', seconds: 1371 },
      { url: 'https://www.youtube.com/watch?v=TlYxWnh_mPs', seconds: 2275 },
    ],
    category: 'Software Engineering',
    difficulty: 'ADVANCED',
    shortDescription: 'Production distributed systems, strict type-level metaprogramming, and transactional patterns.',
    description:
      'Master domain-driven design, concurrent backend patterns, and resilient client-side execution in strict TypeScript. Designed to take senior engineers from operational competence to autonomous system architects through hands-on benchmark implementations.',
    tags: ['typescript', 'architecture', 'distributed-systems'],
    durationDays: 30,
    gracePeriodHours: 24,
    baseStake: 100,
    completionReward: 50,
    commitmentBonus: 40,
    performanceBonus: 50,
    performanceThreshold: 85,
    moduleWeight: 70,
    finalTestWeight: 30,
    moduleQuizWeight: 30,
    moduleAssessmentWeight: 70,
    minFinalTestScore: 50,
    maxAttempts: 3,
    requiredWatchPercent: 90,
    commitmentOptions: [
      { label: 'Finish in 20 days', durationDays: 20, commitmentStake: 100, commitmentBonus: 40, isDefault: true },
      { label: 'Finish in 14 days (aggressive)', durationDays: 14, commitmentStake: 150, commitmentBonus: 80, isDefault: false },
    ],
    modules: [
      {
        title: 'Type-Level Foundations & Compiler Mechanics',
        summary: 'Abstract syntax trees, type narrowing and the compiler\'s inference pipeline.',
        videoTitle: 'Abstract Syntax Trees & Type Narrowing',
        videoDescription: 'How the compiler resolves a union type and where narrowing actually happens.',
        readingTitle: 'Conditional Types & Template Literals',
        readingBody:
          'Conditional types follow the form `T extends U ? X : Y`. Because the compiler evaluates them during inference, they compose into remarkably expressive utilities. Template literal types extend this to string manipulation, and together they let you encode invariants that the runtime never has to check.',
        readingPrompt: 'Which keyword starts a conditional type expression?',
        readingAnswer: 'extends',
        quizTitle: 'Conditional Types & Template Literals',
        quizQuestions: [
          choiceQuestion(
            'What is the primary benefit of strict null checks in enterprise codebases?',
            'Strict null checks make nullability explicit, so the compiler forces handling before the value reaches runtime.',
            'Eliminates runtime null and undefined errors at compile time',
            [
              ['Decreases production bundle file size', 'Type erasure already removes this information.'],
              ['Enables faster build compilation speeds', 'Strictness tends to increase checking work.'],
              ['Automatically coerces falsy values to empty strings', 'No such coercion occurs.'],
            ],
          ),
          choiceQuestion(
            'Given `type A = T extends string ? 1 : 2`, what is `A` when `T` is a union of `string | number`?',
            'Distributive conditional types map over each union member and re-union the results.',
            'A union of 1 and 2',
            [
              ['Always 2', 'Only true when every member fails the check.'],
              ['Always 1', 'Only true when every member passes the check.'],
              ['A compiler error', 'Distribution is the documented behaviour.'],
            ],
          ),
        ],
        assessmentTitle: 'Schema Validator Engine',
        assessmentQuestions: [
          choiceQuestion(
            'Which construct best models a state machine that cannot represent an invalid state?',
            'A discriminated union makes each valid state a distinct member, so invalid combinations cannot be constructed.',
            'A discriminated union on a literal tag',
            [
              ['A boolean pair of flags', 'Four combinations exist, two of which are invalid.'],
              ['An optional-field interface', 'Optionality admits contradictory states.'],
              ['A string enum', 'Enums carry no payload to discriminate on.'],
            ],
          ),
          choiceQuestion(
            'Why prefer `unknown` over `any` at module boundaries?',
            '`unknown` forces you to narrow before use, preserving type safety at the boundary.',
            'It requires verification before use, unlike any',
            [
              ['It is faster at runtime', 'Both erase identically.'],
              ['It permits implicit property access', 'It explicitly forbids it.'],
              ['It avoids emitting declarations', 'Unrelated to declaration emit.'],
            ],
          ),
        ],
      },
      {
        title: 'Transactional Workflows & Event-Driven Architecture',
        summary: 'Outbox patterns, sagas and compensation for cross-service consistency.',
        videoTitle: 'Outbox Pattern & Idempotent Handlers',
        videoDescription: 'Writing the outbox row in the same transaction as the state change.',
        readingTitle: 'Distributed Sagas & Compensation Steps',
        readingBody:
          'A saga coordinates a long-running business process as a sequence of local transactions, each paired with a compensating action. Because there is no global lock, every step must be idempotent and every failure path must be reversible. The key discipline is that the compensating action is designed at the same time as the forward action.',
        quizTitle: 'Distributed Sagas & Compensation Steps',
        quizQuestions: [
          choiceQuestion(
            'What problem does the transactional outbox solve?',
            'It guarantees the message is published if and only if the state change commits, by writing both in one transaction.',
            'Atomicity between a database commit and a message publish',
            [
              ['Message ordering across partitions', 'Ordering requires a different mechanism.'],
              ['Reducing broker storage costs', 'Not the purpose.'],
              ['Encrypting payloads at rest', 'Unrelated concern.'],
            ],
          ),
          choiceQuestion(
            'Why must saga compensation handlers be idempotent?',
            'Retries and at-least-once delivery mean a compensating action can be applied more than once.',
            'Because delivery is at-least-once and retries will re-run them',
            [
              ['Because they run in parallel', 'Compensations are usually sequential.'],
              ['Because they skip the database', 'They typically write to it.'],
              ['Because they are always read-only', 'They mutate state by definition.'],
            ],
          ),
        ],
        assessmentTitle: 'Resilient Order Pipeline',
        assessmentQuestions: [
          choiceQuestion(
            'A learner retries a settlement request that already committed. What must happen?',
            'The operation should detect the settled state and return the existing receipt rather than double-crediting.',
            'Detect the settled state and return the existing result',
            [
              ['Credit the wallet again', 'This double-spends the platform economy.'],
              ['Fail with a 500 error', 'A retry of an idempotent operation is not a server fault.'],
              ['Delete the earlier transaction', 'Destroys the audit trail.'],
            ],
          ),
          choiceQuestion(
            'Which index best supports a query filtering on status and ordering by deadline?',
            'A composite index leading with the equality column then the range/sort column lets the planner avoid a sort.',
            'A composite index on (status, normal_deadline)',
            [
              ['A single-column index on status', 'Still requires a sort on the deadline.'],
              ['A single-column index on normal_deadline', 'Cannot satisfy the equality filter efficiently.'],
              ['No index; sequential scan', 'Degrades as the table grows.'],
            ],
          ),
        ],
      },
      {
        title: 'Performance, Memory Leaks & Node.js Internals',
        summary: 'Heap snapshots, event-loop phasing and allocation profiling.',
        videoTitle: 'V8 Heap Snapshots & Profiling',
        videoDescription: 'Reading retained size and locating the detached DOM or closure leak.',
        readingTitle: 'Event Loop Phasing & Libuv',
        readingBody:
          'The event loop processes timers, pending callbacks, idle/prepare, polling, check and close callbacks in order, with microtasks draining between each phase. A synchronous CPU-bound task in any phase starves the poll phase, which is why CPU-heavy work belongs in a worker thread.',
        quizTitle: 'Event Loop Phasing & Libuv',
        quizQuestions: [
          choiceQuestion(
            'Where do Promise callbacks run relative to timer callbacks?',
            'Microtasks drain completely after each macrotask, so resolved promises run before the next timer phase.',
            'Microtasks run before the next timer callback',
            [
              ['Timers always run first', 'Only if no microtasks are pending.'],
              ['They run in the poll phase only', 'Microtask draining is not a phase.'],
              ['They are scheduled as I/O callbacks', 'They are a distinct queue.'],
            ],
          ),
        ],
        assessmentTitle: 'Zero-Allocation Parser',
        assessmentQuestions: [
          choiceQuestion(
            'Which technique most directly reduces steady-state GC pressure?',
            'Reusing buffers keeps the allocation rate low, which keeps the young generation small.',
            'Reusing preallocated buffers instead of allocating per request',
            [
              ['Forcing frequent manual GC calls', 'Manual GC adds pauses without removing allocation.'],
              ['Increasing the heap ceiling', 'It delays rather than reduces collection.'],
              ['Disabling the type checker', 'Unrelated to runtime allocation.'],
            ],
          ),
        ],
      },
    ],
    finalTitle: 'Final Course Assessment — Full-Stack TypeScript & Architecture',
    finalQuestions: [
      choiceQuestion(
        'A saga step fails after the forward action committed. What is the correct next move?',
        'Run the compensating action for the committed step, then propagate the failure outward.',
        'Execute the compensating transaction for the committed step',
        [
          ['Roll back with a distributed lock', 'No global lock exists to roll back against.'],
          ['Ignore it and continue the saga', 'Leaves the system inconsistent.'],
          ['Retry the forward action indefinitely', 'Would duplicate the side effect.'],
        ],
      ),
      choiceQuestion(
        'Which statement about idempotency keys is correct?',
        'The key must be stored transactionally with the effect so replays can be detected reliably.',
        'They must be persisted atomically alongside the effect they guard',
        [
          ['They can live in process memory', 'Lost on restart, so replays are undetectable.'],
          ['They remove the need for transactions', 'They complement transactions; they do not replace them.'],
          ['They only work for read endpoints', 'They are most useful for writes.'],
        ],
      ),
      choiceQuestion(
        'What does a composite index on (status, deadline) enable that two single-column indexes do not?',
        'It satisfies the equality filter and the ordered range scan in one index pass, avoiding a sort.',
        'An equality filter plus an ordered range scan without a sort',
        [
          ['Faster writes', 'More indexes generally slow writes.'],
          ['Automatic partition pruning', 'Unrelated mechanism.'],
          ['Row-level locking', 'Locking is independent of indexing.'],
        ],
      ),
    ],
    instructorIndex: 0,
  },
  {
    title: 'Applied Systems Programming',
    code: 'CS-402',
    videos: [
      { url: 'https://www.youtube.com/watch?v=aeDyDIo-G44', seconds: 2933 },
      { url: 'https://www.youtube.com/watch?v=eVpaazxsu_I', seconds: 251 },
    ],
    category: 'Computer Science',
    difficulty: 'EXPERT',
    shortDescription: 'Memory arenas, cache alignment, and concurrency primitives from first principles.',
    description:
      'Build the mental model that separates engineers who write code from engineers who understand what the machine does with it: allocation strategy, cache behaviour, and the real cost of synchronisation.',
    tags: ['systems', 'memory', 'concurrency'],
    durationDays: 45,
    gracePeriodHours: 48,
    baseStake: 200,
    completionReward: 120,
    commitmentBonus: 80,
    performanceBonus: 100,
    performanceThreshold: 90,
    moduleWeight: 60,
    finalTestWeight: 40,
    moduleQuizWeight: 40,
    moduleAssessmentWeight: 60,
    minFinalTestScore: 60,
    maxAttempts: 2,
    requiredWatchPercent: 90,
    commitmentOptions: [
      { label: 'Finish in 30 days', durationDays: 30, commitmentStake: 150, commitmentBonus: 80, isDefault: true },
    ],
    modules: [
      {
        title: 'Memory Arenas & Cache Alignment',
        summary: 'Arena allocation, false sharing and padding for the cache line.',
        videoTitle: 'Memory Arenas & Cache Alignment',
        videoDescription: 'Why allocation strategy dominates algorithmic micro-optimisation.',
        readingTitle: 'False Sharing & Padding',
        readingBody:
          'False sharing occurs when two threads write to independent variables that happen to share a cache line. The cache coherency protocol invalidates the whole line, so both cores thrash. Padding the structure so each hot variable owns its own 64-byte line removes the contention entirely, even though no single variable changed.',
        quizTitle: 'Arena Allocation Strategies',
        quizQuestions: [
          choiceQuestion(
            'What is the main advantage of arena allocation?',
            'Freeing the entire arena at once removes per-object bookkeeping from the hot path.',
            'Deallocation becomes a single bulk operation',
            [
              ['It eliminates fragmentation entirely', 'It can actually increase fragmentation.'],
              ['It removes the need for bounds checks', 'Unrelated concern.'],
              ['It makes objects globally addressable', 'Arenas are typically region-scoped.'],
            ],
          ),
          choiceQuestion(
            'Why does padding a struct reduce false sharing?',
            'Separating hot variables onto distinct cache lines stops cross-core invalidation.',
            'It places hot variables on separate cache lines',
            [
              ['It reduces the struct size', 'Padding increases the size.'],
              ['It converts writes to reads', 'Writes remain writes.'],
              ['It disables the coherency protocol', 'Padding works with the protocol.'],
            ],
          ),
        ],
        assessmentTitle: 'Allocator Benchmark Harness',
        assessmentQuestions: [
          choiceQuestion(
            'A benchmark shows high variance across runs. What should you fix first?',
            'Measurement noise usually dominates before the optimisation does; pin the environment and warm up first.',
            'Stabilise the measurement environment and warm up the code',
            [
              ['Increase the iteration count only', 'Averages noise rather than removing it.'],
              ['Optimise the innermost loop first', 'Premature without a stable baseline.'],
              ['Disable the profiler', 'Profiling overhead is a symptom, not the cause.'],
            ],
          ),
        ],
      },
      {
        title: 'Concurrency Primitives & Atomics',
        summary: 'Compare-and-swap, memory ordering and lock-free structures.',
        videoTitle: 'Compare-and-Swap & Memory Ordering',
        videoDescription: 'What acquire/release actually guarantees to the compiler and the CPU.',
        readingTitle: 'Lock-Free Stacks & ABA',
        readingBody:
          'The ABA problem arises when a value changes from A to B and back to A between a read and a compare-and-swap, so the CAS succeeds against a stale assumption. Tagging the pointer with a monotonically increasing counter makes the state change observable and the swap safe.',
        quizTitle: 'Atomics & Memory Ordering',
        quizQuestions: [
          choiceQuestion(
            'What does an acquire operation guarantee?',
            'No later memory operation may be reordered before the acquire, so subsequent reads observe the released writes.',
            'Subsequent reads and writes cannot move before it',
            [
              ['Prior writes cannot move after it', 'That is the release direction.'],
              ['All threads block until it completes', 'Atomics do not block other threads.'],
              ['The cache line is flushed to disk', 'Durability is a separate concern.'],
            ],
          ),
          choiceQuestion(
            'How is the ABA problem typically solved?',
            'Attaching a version counter to the pointer makes a repeated value distinguishable.',
            'Tagging the pointer with a version counter',
            [
              ['Using a global mutex', 'Defeats the lock-free property.'],
              ['Adding memory fences', 'Fences order memory, they do not detect ABA.'],
              ['Using weak memory ordering', 'Weakens guarantees further.'],
            ],
          ),
        ],
        assessmentTitle: 'Lock-Free Queue Verification',
        assessmentQuestions: [
          choiceQuestion(
            'Which property must a linearizable concurrent queue guarantee?',
            'Every operation appears to take effect atomically at some point between its invocation and response.',
            'Each operation appears to take effect atomically at a single instant',
            [
              ['Operations complete in bounded time', 'That is lock-freedom, a different property.'],
              ['Operations never fail', 'Not required by linearizability.'],
              ['All threads make progress', 'Also a progress property, not linearizability.'],
            ],
          ),
        ],
      },
    ],
    finalTitle: 'Final Course Assessment — Applied Systems Programming',
    finalQuestions: [
      choiceQuestion(
        'A concurrent counter undercounts under load. Which cause is most likely?',
        'A read-modify-write sequence without atomicity loses updates when two threads interleave.',
        'A non-atomic increment losing interleaved updates',
        [
          ['Integer overflow', 'Would produce bizarre large values, not a small undercount.'],
          ['Cache line eviction', 'Eviction does not lose committed writes.'],
          ['Missing volatile keyword', 'Volatile does not make read-modify-write atomic.'],
        ],
      ),
      choiceQuestion(
        'Which allocation pattern keeps the hottest data on one cache line?',
        'Grouping fields by access pattern and ordering by size keeps hot data compact and co-accessed.',
        'Ordering fields by size and access frequency together',
        [
          ['Ordering fields alphabetically', 'Ignores access patterns entirely.'],
          ['Placing each field on its own page', 'Wastes memory and hurts locality.'],
          ['Using deep inheritance', 'Adds indirection and pointer chasing.'],
        ],
      ),
    ],
    instructorIndex: 1,
  },
  {
    title: 'Kubernetes Fundamentals',
    code: 'OPS-109',
    videos: [
      { url: 'https://www.youtube.com/watch?v=Mn6Jc0AOUTE', seconds: 1725 },
      { url: 'https://www.youtube.com/watch?v=jtf4SnGBp0E', seconds: 5760 },
    ],
    category: 'Cloud & Operations',
    difficulty: 'INTERMEDIATE',
    shortDescription: 'Ingress controllers, service mesh overlays and workload lifecycle management.',
    description:
      'Operate real clusters with confidence: scheduling, ingress, progressive delivery and the failure modes that only appear under production traffic.',
    tags: ['kubernetes', 'devops', 'networking'],
    durationDays: 21,
    gracePeriodHours: 12,
    baseStake: 150,
    completionReward: 80,
    commitmentBonus: 60,
    performanceBonus: 60,
    performanceThreshold: 80,
    moduleWeight: 80,
    finalTestWeight: 20,
    moduleQuizWeight: 50,
    moduleAssessmentWeight: 50,
    minFinalTestScore: null,
    maxAttempts: 4,
    requiredWatchPercent: 85,
    commitmentOptions: [
      { label: 'Finish in 14 days', durationDays: 14, commitmentStake: 100, commitmentBonus: 60, isDefault: true },
    ],
    modules: [
      {
        title: 'Workload Lifecycle & Scheduling',
        summary: 'Deployments, readiness gates and disruption budgets.',
        videoTitle: 'Deployments, Probes & Disruption Budgets',
        videoDescription: 'Why a readiness gate is what actually protects your users.',
        readingTitle: 'Rollout Strategies',
        readingBody:
          'Rolling updates trade capacity for safety. A maxSurge of 25% adds new pods before removing old ones, so capacity never dips below the requested level; maxUnavailable trades the opposite way. Blue-green replaces the whole fleet at once and relies on a service selector swap for cutover.',
        quizTitle: 'Probes & Rollout Strategy',
        quizQuestions: [
          choiceQuestion(
            'What distinguishes a readiness probe from a liveness probe?',
            'Readiness removes the pod from service endpoints without restarting it; liveness restarts the container.',
            'Readiness controls traffic, liveness triggers restarts',
            [
              ['They are interchangeable', 'They have distinct failure semantics.'],
              ['Liveness controls traffic', 'That is the readiness role.'],
              ['Readiness restarts the pod', 'Readiness never restarts.'],
            ],
          ),
          choiceQuestion(
            'A pod is Running but receives no traffic. What is the most likely cause?',
            'A failing readiness probe keeps the pod out of the endpoints list despite a running container.',
            'Its readiness probe is failing',
            [
              ['The image is missing', 'The container would not be Running.'],
              ['No resource limits are set', 'Unrelated to endpoint membership.'],
              ['The node is cordoned', 'The pod would be evicted, not silently skipped.'],
            ],
          ),
        ],
        assessmentTitle: 'Zero-Downtime Rollout Plan',
        assessmentQuestions: [
          choiceQuestion(
            'Which setting guarantees capacity never drops during a rollout?',
            'A maxSurge greater than zero adds capacity before any pod is removed.',
            'maxSurge greater than zero with maxUnavailable at zero',
            [
              ['maxUnavailable of 100%', 'Removes everything at once.'],
              ['Recreate strategy', 'Causes a hard outage window.'],
              ['A larger resource request', 'Affects scheduling, not rollout order.'],
            ],
          ),
        ],
      },
      {
        title: 'Ingress Controllers & Mesh Overlays',
        summary: 'Layer 7 routing, TLS termination and sidecar traffic policy.',
        videoTitle: 'Ingress Controllers & Mesh Overlays',
        videoDescription: 'Where the ingress ends and the mesh begins.',
        readingTitle: 'Traffic Splitting',
        readingBody:
          'Canary releases route a small percentage of live traffic to the new version and watch the error budget. Because the split happens at the proxy layer, the decision is reversible in seconds — which is what makes canarying safer than a big-bang rollout.',
        quizTitle: 'Ingress & Traffic Splitting',
        quizQuestions: [
          choiceQuestion(
            'Where is TLS typically terminated in a mesh-enabled cluster?',
            'The ingress gateway terminates external TLS, and the mesh mints its own certificates for pod-to-pod traffic.',
            'At the ingress gateway, with mTLS inside the mesh',
            [
              ['In every application container', 'Would duplicate certificate management.'],
              ['Only at the load balancer', 'Leaves in-cluster traffic unencrypted.'],
              ['Nowhere; TLS is not used', 'Incorrect in production clusters.'],
            ],
          ),
        ],
        assessmentTitle: 'Ingress Failure Diagnosis',
        assessmentQuestions: [
          choiceQuestion(
            'Requests return 502 from the ingress but pods respond correctly internally. What should you check first?',
            'A 502 from the proxy usually means the upstream address it targets is wrong or the port is not exposed.',
            'The service selector, target port and endpoint list',
            [
              ['Application log verbosity', 'The app is already proven healthy.'],
              ['Node kernel version', 'Unrelated to upstream resolution.'],
              ['Container image registry credentials', 'The pods are already running.'],
            ],
          ),
        ],
      },
    ],
    finalTitle: 'Final Course Assessment — Kubernetes Fundamentals',
    finalQuestions: [
      choiceQuestion(
        'Which object enforces a minimum availability level during voluntary disruption?',
        'A PodDisruptionBudget bounds how many replicas may be taken down by voluntary actions such as drains.',
        'PodDisruptionBudget',
        [
          ['LimitRange', 'Constrains per-pod resource requests.'],
          ['NetworkPolicy', 'Controls traffic, not availability.'],
          ['ResourceQuota', 'Caps namespace consumption.'],
        ],
      ),
      choiceQuestion(
        'A canary shows a 3% error rate while baseline is 0.1%. What is the correct response?',
        'Roll the traffic split back to zero immediately, then diagnose from the retained canary logs.',
        'Shift traffic back to the stable version and investigate',
        [
          ['Increase canary traffic to gather more data', 'Worsens user impact for no benefit.'],
          ['Scale the canary up', 'Scaling does not fix a logic error.'],
          ['Wait for the error budget to drain', 'Unnecessarily harmful.'],
        ],
      ),
    ],
    instructorIndex: 2,
  },
  {
    title: 'Statistical Arbitrage & Risk Mitigation',
    code: 'QNT-220',
    videos: [
      { url: 'https://www.youtube.com/watch?v=qUMW9LEv4Qw', seconds: 895 },
      { url: 'https://www.youtube.com/watch?v=f73ItMWO4z8', seconds: 900 },
    ],
    category: 'Quantitative Finance',
    difficulty: 'ADVANCED',
    shortDescription: 'Cointegration, pairs trading strategies and execution guards under severe regime shifts.',
    description:
      'Rigorous six-week accountability track covering cointegration, pairs trading strategies, and execution guards. Learn to hedge tail risk under severe regime shifts.',
    tags: ['quant', 'statistics', 'risk'],
    durationDays: 42,
    gracePeriodHours: 24,
    baseStake: 250,
    completionReward: 150,
    commitmentBonus: 100,
    performanceBonus: 120,
    performanceThreshold: 88,
    moduleWeight: 65,
    finalTestWeight: 35,
    moduleQuizWeight: 35,
    moduleAssessmentWeight: 65,
    minFinalTestScore: 55,
    maxAttempts: 3,
    requiredWatchPercent: 90,
    commitmentOptions: [
      { label: 'Finish in 28 days', durationDays: 28, commitmentStake: 200, commitmentBonus: 100, isDefault: true },
      { label: 'Finish in 21 days (aggressive)', durationDays: 21, commitmentStake: 250, commitmentBonus: 150, isDefault: false },
    ],
    modules: [
      {
        title: 'Theoretical Foundations of Pairs Trading',
        summary: 'Stationarity, unit roots and the augmented Dickey-Fuller test.',
        videoTitle: 'Stationarity, Unit Roots & ADF Testing',
        videoDescription: 'Why a spread that looks mean-reverting may simply be trending slowly.',
        readingTitle: 'Cointegration vs Correlation',
        readingBody:
          'Correlation measures co-movement of returns; cointegration describes a linear combination that is stationary. Two series can be highly correlated yet drift apart forever, so a pairs strategy must test the residual for stationarity rather than trusting the correlation coefficient.',
        readingPrompt: 'Which test examines a residual series for a unit root?',
        readingAnswer: 'augmented dickey-fuller',
        quizTitle: 'ADF Test Statistics Diagnostic',
        quizQuestions: [
          choiceQuestion(
            'A high correlation between two price series implies what?',
            'Nothing about long-run convergence — correlation of returns says nothing about the spread',
            'Correlation alone says nothing about long-run convergence',
            [
              ['A profitable pairs trade exists', 'Profitability also needs a stationary spread.'],
              ['The spread is stationary', 'That requires a unit-root test.'],
              ['Both series are random walks', 'Unrelated to the correlation value.'],
            ],
          ),
          choiceQuestion(
            'What does failing to reject the ADF null hypothesis mean?',
            'The series behaves like a unit root (non-stationary), so the spread may drift without bound',
            'The series is likely non-stationary',
            [
              ['The series is definitely stationary', 'That is the alternative hypothesis.'],
              ['The test is invalid', 'A failure to reject is a valid outcome.'],
              ['The series is cointegrated', 'It is evidence against cointegration.'],
            ],
          ),
        ],
        assessmentTitle: 'Synthetic Spread Construction',
        assessmentQuestions: [
          choiceQuestion(
            'You build a spread whose ADF p-value is 0.42. What is the correct conclusion?',
            'A p-value that high fails to reject the unit-root null, so the spread is not tradeable as a mean-reverting pair.',
            'The spread is not statistically tradeable and the pair should be rejected',
            [
              ['Trade it with a wider stop', 'The premise itself is unsupported.'],
              ['Increase the lookback window until p < 0.05', 'That is p-hacking.'],
              ['Add leverage to improve returns', 'Amplifies a bad premise.'],
            ],
          ),
        ],
      },
      {
        title: 'Kalman Filtering & Dynamic Hedge Ratios',
        summary: 'Time-varying beta and state-space estimation in live markets.',
        videoTitle: 'State-Space Formulation of Beta Evolution',
        videoDescription: 'Recursive estimation of a hedge ratio that actually adapts.',
        readingTitle: 'Process Noise & Observation Noise',
        readingBody:
          'The Kalman gain balances trust in the model against trust in the new observation. Raising process noise makes the filter track recent data faster at the cost of stability; raising observation noise smooths the estimate and slows adaptation.',
        quizTitle: 'Kalman Gain Tuning',
        quizQuestions: [
          choiceQuestion(
            'Increasing process noise in a Kalman filter has what effect?',
            'The gain rises, so the estimate tracks new observations more aggressively.',
            'The filter adapts faster to recent observations',
            [
              ['The filter becomes more stable', 'Stability comes from lowering process noise.'],
              ['The estimate stops updating', 'That would be zero gain.'],
              ['The observation model changes', 'Process noise affects state evolution only.'],
            ],
          ),
        ],
        assessmentTitle: 'Live Execution Guard Review',
        assessmentQuestions: [
          choiceQuestion(
            'A live pair diverges far beyond its historical range. What is the disciplined response?',
            'A regime break invalidates the historical estimate; the correct action is to de-risk rather than average down.',
            'Reduce or close exposure and re-estimate before trading again',
            [
              ['Double the position to average down', 'Assumes mean reversion that may no longer hold.'],
              ['Ignore the signal until the stop triggers', 'Passive risk taking.'],
              ['Switch to a longer lookback without review', 'Masks a structural break.'],
            ],
          ),
        ],
      },
    ],
    finalTitle: 'Final Course Assessment — Statistical Arbitrage & Risk Mitigation',
    finalQuestions: [
      choiceQuestion(
        'Which pair of conditions makes a pairs trade statistically defensible?',
        'A stationary spread plus a plausible economic linkage makes the relationship durable rather than coincidental.',
        'A stationary residual combined with an economic rationale',
        [
          ['High return correlation alone', 'Correlation is not sufficient.'],
          ['A low p-value with no economic story', 'Encourages spurious findings.'],
          ['Both series rising together', 'Co-movement can be pure trend.'],
        ],
      ),
      choiceQuestion(
        'Why must a backtest include transaction costs and borrow costs?',
        'High-turnover strategies can turn a gross profit into a net loss once implementation costs are applied.',
        'Because turnover-heavy signals are frequently unprofitable net of costs',
        [
          ['They improve the Sharpe ratio', 'Costs reduce, not improve, returns.'],
          ['They are required by regulators', 'Not a modelling rationale.'],
          ['They only matter for equities', 'They matter for every traded instrument.'],
        ],
      ),
    ],
    instructorIndex: 0,
  },
  {
    title: 'Data Structures & Algorithmic Analysis',
    code: 'CS-201',
    videos: [{ url: 'https://www.youtube.com/watch?v=Ndvm7Ge4pic', seconds: 1341 }],
    category: 'Computer Science',
    difficulty: 'BEGINNER',
    shortDescription: 'Asymptotic analysis, core data structures, and algorithmic problem-solving.',
    description:
      'The foundation course: how to reason about cost, choose the right structure, and prove that your solution scales before you ship it.',
    tags: ['algorithms', 'data-structures', 'foundations'],
    durationDays: 28,
    gracePeriodHours: 24,
    baseStake: 80,
    completionReward: 40,
    commitmentBonus: 30,
    performanceBonus: 40,
    performanceThreshold: 85,
    moduleWeight: 70,
    finalTestWeight: 30,
    moduleQuizWeight: 40,
    moduleAssessmentWeight: 60,
    minFinalTestScore: null,
    maxAttempts: 5,
    requiredWatchPercent: 80,
    commitmentOptions: [
      { label: 'Finish in 21 days', durationDays: 21, commitmentStake: 60, commitmentBonus: 30, isDefault: true },
    ],
    modules: [
      {
        title: 'Asymptotic Analysis & Amortised Cost',
        summary: 'Big-O, amortised analysis and the cost of resizing.',
        videoTitle: 'Big-O, Big-Theta & Amortised Analysis',
        videoDescription: 'Why a dynamic array push is O(1) amortised despite occasional O(n) resizes.',
        readingTitle: 'Amortised vs Average Case',
        readingBody:
          'Amortised analysis averages cost over a worst-case sequence of operations, so it makes no probabilistic assumption. Average-case analysis assumes an input distribution. Confusing the two leads to incorrect complexity claims about structures like hash tables and dynamic arrays.',
        readingPrompt: 'What is the amortised cost of appending to a dynamic array?',
        readingAnswer: 'constant',
        quizTitle: 'Complexity Analysis Checkpoint',
        quizQuestions: [
          choiceQuestion(
            'What is the amortised complexity of appending to a dynamic array?',
            'Geometric growth means the total cost of n appends is O(n), so each append is O(1) amortised.',
            'O(1) amortised',
            [
              ['O(n) worst case per operation', 'That is the cost when a resize occurs, not the amortised cost.'],
              ['O(log n)', 'No logarithmic factor is involved.'],
              ['O(n log n)', 'That describes comparison sorting.'],
            ],
          ),
          choiceQuestion(
            'Which structure gives O(1) average lookup by key?',
            'A well-distributed hash table resolves a key to a bucket in constant expected time.',
            'A hash table',
            [
              ['A sorted array', 'Lookup requires binary search, O(log n).'],
              ['A linked list', 'Lookup is O(n).'],
              ['A binary heap', 'Ordered by priority, not by key.'],
            ],
          ),
        ],
        assessmentTitle: 'Complexity Audit Worksheet',
        assessmentQuestions: [
          choiceQuestion(
            'An algorithm is O(n²) at n=1,000 and takes 10 ms. Roughly how long at n=10,000?',
            'Quadratic growth multiplies cost by 100 when input grows by 10x.',
            'About 1 second',
            [
              ['About 100 ms', 'Corresponds to a 10x input with linear growth.'],
              ['About 10 seconds', 'Corresponds to an extra factor of ten.'],
              ['Unchanged', 'Growth is quadratic, not constant.'],
            ],
          ),
        ],
      },
    ],
    finalTitle: 'Final Course Assessment — Data Structures & Algorithmic Analysis',
    finalQuestions: [
      choiceQuestion(
        'Which structure best supports repeated "find the smallest element" operations?',
        'A binary heap keeps the minimum at the root with O(log n) insertion and removal.',
        'A min-heap',
        [
          ['A stack', 'Ordered by insertion, not by value.'],
          ['A queue', 'Also insertion-ordered.'],
          ['An unsorted array', 'Requires an O(n) scan each time.'],
        ],
      ),
      choiceQuestion(
        'Why is a balanced BST preferred over a plain BST for adversarial input?',
        'Balance bounds the height to O(log n) regardless of insertion order, preventing degenerate chains.',
        'Balancing keeps height logarithmic regardless of insertion order',
        [
          ['It stores fewer elements', 'It stores exactly the same elements.'],
          ['It removes the need for comparisons', 'Comparisons are still used for ordering.'],
          ['It guarantees O(1) lookup', 'Lookup remains O(log n).'],
        ],
      ),
    ],
    instructorIndex: 1,
  },
  {
    title: 'Product Analytics & Experimentation',
    code: 'PRD-140',
    videos: [{ url: 'https://www.youtube.com/watch?v=6BERouEM_bA', seconds: 405 }],
    category: 'Product & Analytics',
    difficulty: 'INTERMEDIATE',
    shortDescription: 'Metric trees, experiment design and causal inference for product decisions.',
    description:
      'Turn product intuition into measured decisions: define metrics that resist gaming, design experiments that actually resolve, and interpret results without fooling yourself.',
    tags: ['product', 'analytics', 'experimentation'],
    durationDays: 24,
    gracePeriodHours: 24,
    baseStake: 120,
    completionReward: 70,
    commitmentBonus: 50,
    performanceBonus: 60,
    performanceThreshold: 82,
    moduleWeight: 75,
    finalTestWeight: 25,
    moduleQuizWeight: 45,
    moduleAssessmentWeight: 55,
    minFinalTestScore: null,
    maxAttempts: 3,
    requiredWatchPercent: 90,
    commitmentOptions: [
      { label: 'Finish in 18 days', durationDays: 18, commitmentStake: 90, commitmentBonus: 50, isDefault: true },
    ],
    modules: [
      {
        title: 'Metric Trees & Counter-Metrics',
        summary: 'North-star decomposition and guardrail metrics.',
        videoTitle: 'Building a Metric Tree That Cannot Be Gamed',
        videoDescription: 'Why every optimisation metric needs a paired guardrail.',
        readingTitle: 'Counter-Metrics in Practice',
        readingBody:
          'Any metric used as a target will eventually be optimised directly. Counter-metrics make the trade-off explicit: pairing "sessions completed" with "drop-off complaints" prevents a change that inflates completion by frustrating learners into leaving.',
        quizTitle: 'Metric Design Anti-Patterns',
        quizQuestions: [
          choiceQuestion(
            'Why pair every optimising metric with a counter-metric?',
            'It makes the unintended cost of optimising the primary metric visible and measurable',
            'To surface the trade-off the primary metric hides',
            [
              ['To increase statistical power', 'Unrelated to power.'],
              ['To reduce sample size needs', 'Counter-metrics add measurement, not power.'],
              ['To remove the need for a control group', 'A control group is still required.'],
            ],
          ),
        ],
        assessmentTitle: 'Experiment Design Review',
        assessmentQuestions: [
          choiceQuestion(
            'A test shows +2% conversion with p=0.08 after 3 days. What is the right call?',
            'The result is not significant and the sample is likely underpowered; extend to the pre-computed sample size before deciding.',
            'Continue to the pre-registered sample size before concluding',
            [
              ['Ship it; the direction is positive', 'Acting on noise is the classic error.'],
              ['Kill it; p is above 0.05', 'The test is simply not finished.'],
              ['Change the primary metric', 'That is p-hacking.'],
            ],
          ),
        ],
      },
    ],
    finalTitle: 'Final Course Assessment — Product Analytics & Experimentation',
    finalQuestions: [
      choiceQuestion(
        'Which practice most improves the credibility of an experiment result?',
        'Pre-registering the primary metric, sample size and stopping rule removes the discretion that enables p-hacking.',
        'Pre-registering the metric, sample size and stopping rule',
        [
          ['Checking results hourly', 'Peeking inflates false positive rates.'],
          ['Testing many metrics and reporting the winner', 'Guarantees a spurious finding.'],
          ['Extending the test whenever p is close', 'Another form of p-hacking.'],
        ],
      ),
      choiceQuestion(
        'What is a guardrail metric for a course-completion experiment?',
        'A metric that would reveal harm caused by the change, such as increased refund or drop-off complaints.',
        'A metric that would reveal harm from the change',
        [
          ['The primary metric restated', 'A duplicate of the primary metric adds nothing.'],
          ['A vanity metric', 'Vanity metrics do not detect harm.'],
          ['A metric measured only after launch', 'Guardrails must be measured during the test.'],
        ],
      ),
    ],
    instructorIndex: 2,
  },
];

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('Resetting demo data…');
  await reset();

  console.log('Creating reward pool…');
  await RewardPoolService.ensurePool(prisma);

  console.log('Creating users…');
  const admin = await createUser({
    email: 'admin@stakeit.demo',
    fullName: 'Amara Okafor',
    role: 'ADMIN',
    headline: 'Platform administrator',
    bio: 'Runs the Stake It accountability protocol, reward pool and instructor reputation system.',
    grant: 0,
  });

  const instructors = [
    await createUser({
      email: 'instructor@stakeit.demo',
      fullName: 'Dr. Elena Fischer',
      role: 'INSTRUCTOR',
      headline: 'Distributed systems architect · Ex-Principal Engineer',
      bio: 'Fifteen years building transactional platforms. Teaches architecture the way it is actually practised: with failure in mind.',
      expertise: ['Distributed systems', 'TypeScript', 'PostgreSQL', 'Quantitative finance'],
      grant: 300,
    }),
    await createUser({
      email: 'marcus@stakeit.demo',
      fullName: 'Marcus Lindqvist',
      role: 'INSTRUCTOR',
      headline: 'Systems programmer · Memory & concurrency',
      bio: 'Works on allocators, lock-free data structures and performance tooling. Believes most performance bugs are measurement bugs.',
      expertise: ['C/C++', 'Concurrency', 'Algorithms', 'Performance'],
      grant: 200,
    }),
    await createUser({
      email: 'priya@stakeit.demo',
      fullName: 'Priya Raghavan',
      role: 'INSTRUCTOR',
      headline: 'Platform reliability & product analytics',
      bio: 'Operates Kubernetes at scale and designs experiments that survive scrutiny.',
      expertise: ['Kubernetes', 'Observability', 'Experimentation', 'DevOps'],
      grant: 200,
    }),
  ];

  const learners = [
    await createUser({ email: 'learner@stakeit.demo', fullName: 'Rohan Mehta', role: 'LEARNER', headline: 'Full-stack developer', grant: 3000 }),
    await createUser({ email: 'aisha@stakeit.demo', fullName: 'Aisha Bello', role: 'LEARNER', headline: 'Backend engineer', grant: 3000 }),
    await createUser({ email: 'daniel@stakeit.demo', fullName: 'Daniel Kovacs', role: 'LEARNER', headline: 'SRE in transition', grant: 3000 }),
    await createUser({ email: 'sofia@stakeit.demo', fullName: 'Sofia Marchetti', role: 'LEARNER', headline: 'Data engineer', grant: 3000 }),
    await createUser({ email: 'kenji@stakeit.demo', fullName: 'Kenji Watanabe', role: 'LEARNER', headline: 'Quantitative analyst', grant: 3000 }),
    await createUser({ email: 'nadia@stakeit.demo', fullName: 'Nadia Hassan', role: 'LEARNER', headline: 'Computer science student', grant: 3000 }),
  ];

  console.log('Creating courses…');
  const courseIds: string[] = [];
  for (const seed of COURSES) {
    const instructorId = instructors[seed.instructorIndex]?.id ?? instructors[0]!.id;
    courseIds.push(await createCourse(seed, instructorId));
  }

  const shapes = await Promise.all(courseIds.map((id) => loadShape(id)));
  const [typescript, systems, kubernetes, quant, algorithms, product] = shapes;

  /* ---------------------------------------------------------------------- */
  /* Scenario 1 — on-track learner with partial progress                     */
  /* ---------------------------------------------------------------------- */
  console.log('Scenario 1: active learner mid-course…');
  const rohanEnrollment = await EnrollmentService.enroll(courseIds[0]!, learners[0]!.id, {
    accelerated: true,
  });
  {
    const shape = typescript!;
    const firstModuleContents = await prisma.moduleContent.findMany({
      where: { id: { in: shape.contentIds } },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, type: true, moduleId: true, durationSeconds: true },
    });
    const firstModuleId = firstModuleContents[0]!.moduleId;

    // Finish module 1 completely, then half of module 2.
    const moduleOne = firstModuleContents.slice(0, 4);
    for (const content of moduleOne) {
      if (content.type === 'VIDEO') {
        await completeContent(rohanEnrollment.attempt.id, learners[0]!.id, content.id, 'VIDEO', content.durationSeconds ?? 0);
      } else if (content.type === 'READING') {
        await completeContent(rohanEnrollment.attempt.id, learners[0]!.id, content.id, 'READING', 0);
      }
    }
    const moduleOneQuiz = await prisma.quiz.findFirst({
      where: { content: { moduleId: firstModuleId, type: 'QUIZ' } },
      select: { id: true },
    });
    if (moduleOneQuiz) await passQuiz(moduleOneQuiz.id, rohanEnrollment.attempt.id, learners[0]!.id, 90);

    const moduleOneAssessment = await prisma.assessment.findFirst({
      where: { moduleId: firstModuleId, type: 'MODULE' },
      select: { id: true },
    });
    if (moduleOneAssessment) {
      await passAssessment(moduleOneAssessment.id, rohanEnrollment.attempt.id, learners[0]!.id, 88);
    }

    // Partial progress on module 2: video watched but not completed.
    const secondModuleVideo = firstModuleContents[4];
    if (secondModuleVideo) {
      // Partially-watched state, expressed against that lesson's own length so
      // the percentage means the same thing the player would report.
      const secondVideoSeconds = secondModuleVideo.durationSeconds ?? 0;
      await prisma.contentProgress.create({
        data: {
          attemptId: rohanEnrollment.attempt.id,
          userId: learners[0]!.id,
          contentId: secondModuleVideo.id,
          status: 'IN_PROGRESS',
          watchedSeconds: Math.round(secondVideoSeconds * 0.65),
          validWatchPercent: 65,
          watchedSegments: [[0, Math.round(secondVideoSeconds * 0.65)]] as unknown as object,
          lastPositionSeconds: Math.round(secondVideoSeconds * 0.65),
          activeSeconds: 400,
          firstAccessedAt: new Date(),
        },
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Scenario 2 — at-risk learner (behind expected progress)                 */
  /* ---------------------------------------------------------------------- */
  console.log('Scenario 2: at-risk learner…');
  const aishaEnrollment = await EnrollmentService.enroll(courseIds[2]!, learners[1]!.id, {});
  {
    // Back-date the attempt so ~67% of the window has elapsed with only ~10% progress.
    const startedAt = addDays(new Date(), -14);
    const normalDeadline = addDays(new Date(), 7);
    await prisma.courseAttempt.update({
      where: { id: aishaEnrollment.attempt.id },
      data: { startedAt, normalDeadline, graceDeadline: addHours(normalDeadline, 12) },
    });

    const firstVideo = await prisma.moduleContent.findFirst({
      where: { moduleId: (await prisma.module.findFirstOrThrow({ where: { courseId: courseIds[2]!, orderIndex: 0 } })).id, type: 'VIDEO' },
      select: { id: true },
    });
    if (firstVideo) {
      await prisma.contentProgress.create({
        data: {
          attemptId: aishaEnrollment.attempt.id,
          userId: learners[1]!.id,
          contentId: firstVideo.id,
          status: 'IN_PROGRESS',
          watchedSeconds: 120,
          validWatchPercent: 20,
          watchedSegments: [[0, 120]] as unknown as object,
          lastPositionSeconds: 120,
          activeSeconds: 120,
          firstAccessedAt: new Date(),
        },
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Scenario 3 — completed course with full settlement                      */
  /* ---------------------------------------------------------------------- */
  console.log('Scenario 3: successfully completed course (with accelerated commitment)…');
  const danielEnrollment = await EnrollmentService.enroll(courseIds[1]!, learners[2]!.id, { accelerated: true });
  const danielSettlement = await completeCourseFully(danielEnrollment.attempt.id, learners[2]!.id, systems!, {
    quiz: 95,
    moduleAssessment: 92,
    final: 94,
  });

  /* ---------------------------------------------------------------------- */
  /* Scenario 4 — failed attempt: deadline missed, stake forfeited           */
  /* ---------------------------------------------------------------------- */
  console.log('Scenario 4: failed attempt with forfeiture…');
  const sofiaEnrollment = await EnrollmentService.enroll(courseIds[3]!, learners[3]!.id, {});
  {
    // Push the deadline into the past, then let the real settlement service run.
    const normalDeadline = addDays(new Date(), -3);
    await prisma.courseAttempt.update({
      where: { id: sofiaEnrollment.attempt.id },
      data: {
        startedAt: addDays(normalDeadline, -42),
        normalDeadline,
        graceDeadline: addHours(normalDeadline, 24),
        status: 'ACTIVE',
      },
    });
    await StakeService.settleFailedAttempt(sofiaEnrollment.attempt.id, 'Course deadline missed');
  }

  /* ---------------------------------------------------------------------- */
  /* Scenario 5 — retry after failure, completed on attempt 2                */
  /* ---------------------------------------------------------------------- */
  console.log('Scenario 5: retry recovery reward…');
  const kenjiEnrollment = await EnrollmentService.enroll(courseIds[4]!, learners[4]!.id, {});
  {
    const normalDeadline = addDays(new Date(), -5);
    await prisma.courseAttempt.update({
      where: { id: kenjiEnrollment.attempt.id },
      data: {
        startedAt: addDays(normalDeadline, -28),
        normalDeadline,
        graceDeadline: addHours(normalDeadline, 24),
        status: 'ACTIVE',
      },
    });
    await StakeService.settleFailedAttempt(kenjiEnrollment.attempt.id, 'Course deadline missed');
  }
  // Retry: no new mandatory stake (spec §19/§20).
  const kenjiRetry = await EnrollmentService.retry(kenjiEnrollment.enrollment.id, learners[4]!.id, {});
  await completeCourseFully(kenjiRetry.attempt.id, learners[4]!.id, algorithms!, {
    quiz: 90,
    moduleAssessment: 86,
    final: 91,
  });

  /* ---------------------------------------------------------------------- */
  /* Scenario 6 — in-progress second course for the demo learner             */
  /* ---------------------------------------------------------------------- */
  console.log('Scenario 6: second active course for the primary demo learner…');
  const rohanSecond = await EnrollmentService.enroll(courseIds[5]!, learners[0]!.id, { accelerated: true });
  {
    const shape = product!;
    const contents = await prisma.moduleContent.findMany({
      where: { id: { in: shape.contentIds } },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, type: true, durationSeconds: true },
    });
    for (const content of contents.slice(0, 2)) {
      if (content.type === 'VIDEO') {
        await completeContent(rohanSecond.attempt.id, learners[0]!.id, content.id, 'VIDEO', content.durationSeconds ?? 0);
      } else if (content.type === 'READING') {
        await completeContent(rohanSecond.attempt.id, learners[0]!.id, content.id, 'READING', 0);
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Reviews                                                                 */
  /* ---------------------------------------------------------------------- */
  console.log('Creating reviews…');
  await prisma.courseReview.create({
    data: {
      courseId: courseIds[1]!,
      userId: learners[2]!.id,
      enrollmentId: danielEnrollment.enrollment.id,
      rating: 5,
      difficultyRating: 5,
      wouldRecommend: true,
      reviewText:
        'Brutally rigorous and worth every point. The arena allocation module changed how I read allocation profiles, and the deadline pressure genuinely kept me moving.',
    },
  });
  await prisma.courseReview.create({
    data: {
      courseId: courseIds[4]!,
      userId: learners[4]!.id,
      enrollmentId: kenjiEnrollment.enrollment.id,
      rating: 4,
      difficultyRating: 3,
      wouldRecommend: true,
      reviewText:
        'Failed my first attempt because I over-committed. The retry did not force a second stake, and the recovery reward landed exactly as documented.',
    },
  });
  await prisma.courseReview.create({
    data: {
      courseId: courseIds[2]!,
      userId: learners[5]!.id,
      rating: 4,
      difficultyRating: 4,
      wouldRecommend: true,
      reviewText: 'Clear explanation of readiness versus liveness. The ingress failure lab was the most useful part.',
      isFlagged: false,
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Instructor reputation + badges                                          */
  /* ---------------------------------------------------------------------- */
  console.log('Recomputing instructor reputation…');
  for (const instructor of instructors) {
    await ReputationService.syncBadge(instructor.id, admin.id);
  }

  // A representative platform announcement for every account.
  console.log('Creating notifications…');
  await NotificationService.notify(prisma, {
    userId: learners[1]!.id,
    type: 'AT_RISK',
    title: 'Course at risk',
    message:
      'You are behind expected progress in Kubernetes Fundamentals with 7 day(s) left. 150 points are at stake.',
    link: '/my-courses',
  });
  await NotificationService.notify(prisma, {
    userId: learners[3]!.id,
    type: 'RETRY_AVAILABLE',
    title: 'Retry available',
    message: 'You can retry Statistical Arbitrage & Risk Mitigation — 2 attempt(s) remaining.',
    link: `/courses/${courseIds[3]}`,
  });

  /* ---------------------------------------------------------------------- */
  /* Summary                                                                 */
  /* ---------------------------------------------------------------------- */
  const pool = await RewardPoolService.getPool();
  const counts = {
    users: await prisma.user.count(),
    courses: await prisma.course.count(),
    modules: await prisma.module.count(),
    contents: await prisma.moduleContent.count(),
    quizzes: await prisma.quiz.count(),
    assessments: await prisma.assessment.count(),
    enrollments: await prisma.enrollment.count(),
    attempts: await prisma.courseAttempt.count(),
    stakes: await prisma.stake.count(),
    walletTransactions: await prisma.walletTransaction.count(),
    poolTransactions: await prisma.rewardPoolTransaction.count(),
    reviews: await prisma.courseReview.count(),
    badges: await prisma.instructorBadge.count(),
  };

  console.log('\nSeed complete.');
  console.table(counts);
  console.log(`Reward pool balance: ${pool.balance} points (in ${pool.totalIn} / out ${pool.totalOut})`);
  console.log(`Daniel's settlement: ${danielSettlement.totalCredited} points credited (audit ${danielSettlement.auditReference})`);
  console.log('\nDemo credentials (password for every account): ' + DEMO_PASSWORD);
  console.table([
    { role: 'ADMIN', email: 'admin@stakeit.demo' },
    { role: 'INSTRUCTOR', email: 'instructor@stakeit.demo' },
    { role: 'INSTRUCTOR', email: 'marcus@stakeit.demo' },
    { role: 'INSTRUCTOR', email: 'priya@stakeit.demo' },
    { role: 'LEARNER', email: 'learner@stakeit.demo' },
    { role: 'LEARNER', email: 'aisha@stakeit.demo' },
    { role: 'LEARNER', email: 'daniel@stakeit.demo' },
    { role: 'LEARNER', email: 'sofia@stakeit.demo' },
    { role: 'LEARNER', email: 'kenji@stakeit.demo' },
    { role: 'LEARNER', email: 'nadia@stakeit.demo' },
  ]);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
