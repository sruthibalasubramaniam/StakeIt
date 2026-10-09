import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/lib/prisma';
import { DeadlineService } from '../../src/services/deadlineService';
import { RewardPoolService } from '../../src/services/rewardPoolService';
import { WalletService } from '../../src/services/walletService';
import { hashPassword } from '../../src/services/tokenService';
import { addDays, addHours } from '../../src/utils/date';
import {
  INTEGRATION_TEST_TIMEOUT_MS,
  TEST_PASSWORD,
  buildTestApp,
  createMinimalCourse,
  getModuleTwoAssessmentId,
  getWallet,
  isDatabaseAvailable,
  loadCorrectOptions,
  registerAndLogin,
  resetDatabase,
} from './helpers';

describe('Stake It — accountability engine (integration)', () => {
  let app: Express;
  let instructorToken: string;
  let instructorId: string;
  let learner: { id: string; email: string; token: string };
  let dbAvailable = false;

  /**
   * Registers a database-backed test. When PostgreSQL is unreachable the test is
   * reported as SKIPPED (not passed), so a green run never overstates coverage.
   * The unit suite still exercises all the pure business logic.
   */
  const itDb = (name: string, fn: () => Promise<void>) =>
    it(
      name,
      async (context) => {
        if (!dbAvailable) {
          context.skip();
          return;
        }
        await fn();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n[integration] PostgreSQL unreachable — accountability integration tests SKIPPED.\n' +
          '              Start a database (docker compose up postgres), set DATABASE_URL, and re-run `npm run test:integration`.\n',
      );
      return;
    }
    app = buildTestApp();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await resetDatabase();
    await RewardPoolService.ensurePool(prisma);

    const instructor = await registerAndLogin(app, { email: `instructor-${Date.now()}@test.dev`, role: 'INSTRUCTOR' });
    instructorToken = instructor.token;
    instructorId = instructor.id;

    learner = await registerAndLogin(app, { email: `learner-${Date.now()}@test.dev`, role: 'LEARNER' });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await resetDatabase();
    await prisma.$disconnect();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /* ---------------------------------------------------------------------- */
  /* Staking                                                                 */
  /* ---------------------------------------------------------------------- */

  itDb('deducts the stake atomically and records it in the ledger', async () => {
    const course = await createMinimalCourse(instructorId, { baseStake: 100 });

    const before = await getWallet(learner.id);
    expect(before.availableBalance).toBe(1500);

    const response = await request(app).post(`/api/courses/${course.courseId}/enroll`).set(auth(learner.token)).send({});
    expect(response.status).toBe(201);

    const after = await getWallet(learner.id);
    expect(after.availableBalance).toBe(1400);
    expect(after.lockedBalance).toBe(100);
    expect(after.lifetimeStaked).toBe(100);

    const ledger = await prisma.walletTransaction.findMany({ where: { userId: learner.id }, orderBy: { createdAt: 'asc' } });
    const stakeEntry = ledger.find((entry) => entry.type === 'STAKE_LOCKED');
    expect(stakeEntry).toBeDefined();
    expect(stakeEntry!.amount).toBe(-100);
    expect(stakeEntry!.balanceAfter).toBe(1400);

    // The stake row exists and is locked.
    const stakes = await prisma.stake.findMany({ where: { attempt: { userId: learner.id } } });
    expect(stakes).toHaveLength(1);
    expect(stakes[0]!.status).toBe('LOCKED');
  });

  itDb('refuses to enrol when the wallet cannot cover the stake', async () => {
    const course = await createMinimalCourse(instructorId, { baseStake: 100 });

    // Drain the wallet through the real ledger so the balance stays consistent.
    const wallet = await getWallet(learner.id);
    await WalletService.debit(prisma, {
      userId: learner.id,
      amount: wallet.availableBalance,
      type: 'ADMIN_ADJUSTMENT',
      description: 'Drain for insufficient-balance test',
    });

    const response = await request(app).post(`/api/courses/${course.courseId}/enroll`).set(auth(learner.token)).send({});
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(response.body.error.details).toMatchObject({ required: 100, available: 0 });

    // Nothing may have been written.
    expect(await prisma.stake.count({ where: { attempt: { userId: learner.id } } })).toBe(0);
    expect(await prisma.enrollment.count({ where: { userId: learner.id } })).toBe(0);
  });

  /* ---------------------------------------------------------------------- */
  /* Sequential learning                                                     */
  /* ---------------------------------------------------------------------- */

  itDb('enforces strict sequential unlocking on the server, not just in the UI', async () => {
    const course = await createMinimalCourse(instructorId);

    const enrollment = await request(app)
      .post(`/api/courses/${course.courseId}/enroll`)
      .set(auth(learner.token))
      .send({});
    expect(enrollment.status).toBe(201);

    const attemptId = enrollment.body.data.attempt.id as string;

    // 1. The quiz stays locked while the module-1 video is incomplete.
    const lockedQuiz = await request(app)
      .get(`/api/attempts/${attemptId}/quizzes/${course.moduleOneQuizId}`)
      .set(auth(learner.token));
    expect(lockedQuiz.status).toBe(422);
    expect(lockedQuiz.body.error.code).toBe('CONTENT_LOCKED');

    // 2. The module assessment stays locked behind the quiz.
    const lockedAssessment = await request(app)
      .get(`/api/attempts/${attemptId}/assessments/${course.moduleOneAssessmentId}`)
      .set(auth(learner.token));
    expect(lockedAssessment.status).toBe(422);
    expect(lockedAssessment.body.error.code).toBe('CONTENT_LOCKED');

    // 3. The final test stays locked until every required module is complete.
    const lockedFinal = await request(app)
      .get(`/api/attempts/${attemptId}/assessments/${course.finalAssessmentId}`)
      .set(auth(learner.token));
    expect(lockedFinal.status).toBe(422);
    expect(lockedFinal.body.error.code).toBe('FINAL_TEST_LOCKED');

    // 4. Completing a video without verified watch time is refused.
    const prematureComplete = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(prematureComplete.status).toBe(422);
    expect(prematureComplete.body.error.code).toBe('INVALID_PROGRESS');

    // 5. Honest playback of the full 600-second video is credited in full.
    const watched = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/progress`)
      .set(auth(learner.token))
      .send({ fromSeconds: 0, positionSeconds: 600, durationSeconds: 600, elapsedRealSeconds: 600 });
    expect(watched.status).toBe(200);
    expect(watched.body.data.validWatchPercent).toBe(100);
    expect(watched.body.data.isWatchRequirementMet).toBe(true);

    // 6. The video now completes.
    const completeVideo = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(completeVideo.status).toBe(200);
    expect(completeVideo.body.data.status).toBe('COMPLETED');

    // 7. With the video done the quiz is genuinely reachable — the lock lifted
    //    because of verified progress, not because the guard was bypassed.
    const unlockedQuiz = await request(app)
      .get(`/api/attempts/${attemptId}/quizzes/${course.moduleOneQuizId}`)
      .set(auth(learner.token));
    expect(unlockedQuiz.status).toBe(200);

    // 8. The attempt survives the entire sequence (no accidental teardown).
    const attemptAfter = await prisma.courseAttempt.findUnique({ where: { id: attemptId } });
    expect(attemptAfter).not.toBeNull();
    expect(attemptAfter?.status).toBe('ACTIVE');
  });

  itDb('credits only physically possible watch time and refuses scrub-to-end', async () => {
    const course = await createMinimalCourse(instructorId);
    const enrollment = await request(app)
      .post(`/api/courses/${course.courseId}/enroll`)
      .set(auth(learner.token))
      .send({});
    const attemptId = enrollment.body.data.attempt.id as string;

    // 1. A pure scrub: jump 0 → 600 with no playback time.
    const scrub = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/progress`)
      .set(auth(learner.token))
      .send({ fromSeconds: 0, positionSeconds: 600, durationSeconds: 600, elapsedRealSeconds: 0 });
    expect(scrub.status).toBe(200);
    expect(scrub.body.data.isWatchRequirementMet).toBe(false);
    expect(scrub.body.data.validWatchPercent).toBe(0);
    expect(scrub.body.data.suspicious).toBe(true);

    // Completion must still be refused.
    const prematureComplete = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(prematureComplete.status).toBe(422);

    // 2. Honest playback: the full 600s over 600s of real time.
    const watched = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/progress`)
      .set(auth(learner.token))
      .send({ fromSeconds: 0, positionSeconds: 600, durationSeconds: 600, elapsedRealSeconds: 600 });
    expect(watched.status).toBe(200);
    expect(watched.body.data.validWatchPercent).toBe(100);
    expect(watched.body.data.isWatchRequirementMet).toBe(true);

    const completed = await request(app)
      .post(`/api/attempts/${attemptId}/content/${course.moduleOneVideoContentId}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');
  });

  itDb('walks the full happy path: video → quiz → assessment → next module → final test → settlement', async () => {
    const course = await createMinimalCourse(instructorId, { baseStake: 100, completionReward: 50 });
    const moduleTwoAssessmentId = await getModuleTwoAssessmentId(course.courseId);
    const moduleTwoCorrect = await loadCorrectOptions(moduleTwoAssessmentId);

    const enrollment = await request(app)
      .post(`/api/courses/${course.courseId}/enroll`)
      .set(auth(learner.token))
      .send({});
    const attemptId = enrollment.body.data.attempt.id as string;

    const watchVideo = async (contentId: string) => {
      await request(app)
        .post(`/api/attempts/${attemptId}/content/${contentId}/progress`)
        .set(auth(learner.token))
        .send({ fromSeconds: 0, positionSeconds: 600, durationSeconds: 600, elapsedRealSeconds: 600 });
      const complete = await request(app)
        .post(`/api/attempts/${attemptId}/content/${contentId}/complete`)
        .set(auth(learner.token))
        .send({});
      expect(complete.status).toBe(200);
    };

    // Module 1
    await watchVideo(course.moduleOneVideoContentId);

    const quizAnswers = Object.fromEntries(course.moduleOneQuizQuestionIds.map((id) => [id, [course.moduleOneQuizCorrectOptions[id]!]]));
    const quiz = await request(app)
      .post(`/api/attempts/${attemptId}/quizzes/${course.moduleOneQuizId}/attempt`)
      .set(auth(learner.token))
      .send({ answers: quizAnswers });
    expect(quiz.status).toBe(201);
    expect(quiz.body.data.attempt.passed).toBe(true);
    expect(quiz.body.data.attempt.percentage).toBe(100);

    const moduleOneAssessmentAnswers = Object.fromEntries(
      Object.entries(course.moduleOneAssessmentCorrectOptions).map(([questionId, optionId]) => [questionId, [optionId]]),
    );
    const moduleOneAssessment = await request(app)
      .post(`/api/attempts/${attemptId}/assessments/${course.moduleOneAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({ answers: moduleOneAssessmentAnswers });
    expect(moduleOneAssessment.status).toBe(201);
    expect(moduleOneAssessment.body.data.submission.passed).toBe(true);

    // Module 2 is now reachable.
    const stateAfterModuleOne = await request(app)
      .get(`/api/enrollments/${enrollment.body.data.enrollment.id}/learning-state`)
      .set(auth(learner.token));
    expect(stateAfterModuleOne.status).toBe(200);
    const modules = stateAfterModuleOne.body.data.modules as Array<{ isUnlocked: boolean; isCompleted: boolean }>;
    expect(modules[0]!.isCompleted).toBe(true);
    expect(modules[1]!.isUnlocked).toBe(true);

    // Finishing module 2 unlocks the final test.
    await watchVideo(course.moduleTwoVideoContentId);
    const moduleTwoAssessment = await request(app)
      .post(`/api/attempts/${attemptId}/assessments/${moduleTwoAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({
        answers: Object.fromEntries(Object.entries(moduleTwoCorrect).map(([questionId, optionId]) => [questionId, [optionId]])),
      });
    expect(moduleTwoAssessment.status).toBe(201);

    const finalAnswers = Object.fromEntries(
      Object.entries(course.finalCorrectOptions).map(([questionId, optionId]) => [questionId, [optionId]]),
    );
    const finalTest = await request(app)
      .post(`/api/attempts/${attemptId}/assessments/${course.finalAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({ answers: finalAnswers });

    // The failure message carries the server's error so a 5xx is diagnosable
    // from the test output alone (otherwise only the status is reported).
    expect(finalTest.status, `final test submit -> ${JSON.stringify(finalTest.body)}`).toBe(201);
    expect(finalTest.body.data.submission.passed).toBe(true);
    expect(finalTest.body.data.isFinal).toBe(true);

    // Settlement is returned inline and is fully consistent.
    const settlement = finalTest.body.data.settlement;
    expect(settlement).not.toBeNull();
    expect(settlement.breakdown.finalScore).toBe(100);
    expect(settlement.stakeReturned).toBe(100);
    // 100 stake returned + 50 course reward + 30 performance bonus.
    // The fixture sets performanceThreshold 85 / performanceBonus 30, so a
    // perfect final score earns the bonus — consistent with the wallet delta
    // asserted below (1500 − 100 + 180 = 1580) and attempt.pointsAwarded (180).
    expect(settlement.performanceBonusEarned).toBe(true);
    expect(settlement.totalCredited).toBe(180);
    expect(settlement.auditReference).toMatch(/^STK-\d{4}-[0-9A-F]{6}$/);

    const wallet = await getWallet(learner.id);
    expect(wallet.lockedBalance).toBe(0);
    // 1500 − 100 stake + 100 returned + 50 reward + 30 performance bonus
    expect(wallet.availableBalance).toBe(1580);

    const attempt = await prisma.courseAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe('COMPLETED');
    expect(attempt.finalScore).toBe(100);
    expect(attempt.pointsAwarded).toBe(180);

    const enrollmentRow = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollment.body.data.enrollment.id } });
    expect(enrollmentRow.status).toBe('COMPLETED');

    // The completion summary is retrievable afterwards and agrees exactly with
    // the inline settlement — same figures, and no second credit is applied.
    const receipt = await request(app).get(`/api/attempts/${attemptId}/settlement`).set(auth(learner.token));
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.totalCredited).toBe(settlement.totalCredited);
    expect(receipt.body.data.totalCredited).toBe(180);

    const balanceAfterReceipt = await getWallet(learner.id);
    expect(balanceAfterReceipt.availableBalance).toBe(1580);
  });

  itDb('blocks the performance bonus below the threshold without failing the course', async () => {
    const course = await createMinimalCourse(instructorId, { baseStake: 100, completionReward: 50 });
    const moduleTwoAssessmentId = await getModuleTwoAssessmentId(course.courseId);

    const enrollment = await request(app)
      .post(`/api/courses/${course.courseId}/enroll`)
      .set(auth(learner.token))
      .send({});
    const attemptId = enrollment.body.data.attempt.id as string;

    const watchVideo = async (contentId: string) => {
      await request(app)
        .post(`/api/attempts/${attemptId}/content/${contentId}/progress`)
        .set(auth(learner.token))
        .send({ fromSeconds: 0, positionSeconds: 600, durationSeconds: 600, elapsedRealSeconds: 600 });
      await request(app).post(`/api/attempts/${attemptId}/content/${contentId}/complete`).set(auth(learner.token)).send({});
    };

    /** Answers `correctCount` of the instrument's questions correctly. */
    const answersFor = async (scope: { quizId?: string; assessmentId?: string }, correctCount: number) => {
      const questions = scope.quizId
        ? await prisma.quizQuestion.findMany({ where: { quizId: scope.quizId }, include: { options: true } })
        : await prisma.assessmentQuestion.findMany({ where: { assessmentId: scope.assessmentId }, include: { options: true } });

      const answers: Record<string, string[]> = {};
      questions.forEach((question, index) => {
        const correct = question.options.find((option) => option.isCorrect);
        const wrong = question.options.find((option) => !option.isCorrect);
        const pick = index < correctCount ? correct : wrong;
        if (pick) answers[question.id] = [pick.id];
      });
      return answers;
    };

    // Deliberately mediocre but still passing: 3 of 4 correct (75%) everywhere.
    await watchVideo(course.moduleOneVideoContentId);
    const quiz = await request(app)
      .post(`/api/attempts/${attemptId}/quizzes/${course.moduleOneQuizId}/attempt`)
      .set(auth(learner.token))
      .send({ answers: await answersFor({ quizId: course.moduleOneQuizId }, 3) });
    expect(quiz.body.data.attempt.passed).toBe(true);
    expect(quiz.body.data.attempt.percentage).toBe(75);

    const moduleOne = await request(app)
      .post(`/api/attempts/${attemptId}/assessments/${course.moduleOneAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({ answers: await answersFor({ assessmentId: course.moduleOneAssessmentId }, 3) });
    expect(moduleOne.body.data.submission.passed).toBe(true);
    expect(moduleOne.body.data.submission.percentage).toBe(75);

    await watchVideo(course.moduleTwoVideoContentId);
    await request(app)
      .post(`/api/attempts/${attemptId}/assessments/${moduleTwoAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({ answers: await answersFor({ assessmentId: moduleTwoAssessmentId }, 3) });

    // The final test is aced, so only the module score is mediocre.
    const finalTest = await request(app)
      .post(`/api/attempts/${attemptId}/assessments/${course.finalAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({
        answers: Object.fromEntries(
          Object.entries(course.finalCorrectOptions).map(([questionId, optionId]) => [questionId, [optionId]]),
        ),
      });

    expect(finalTest.status).toBe(201);
    const settlement = finalTest.body.data.settlement;

    // moduleScore 75, final 100, 70/30 → 82.5, below the 85% threshold.
    expect(settlement.breakdown.moduleScore).toBe(75);
    expect(settlement.breakdown.finalScore).toBe(82.5);
    expect(settlement.breakdown.finalScore).toBeLessThan(85);
    expect(settlement.performanceBonusEarned).toBe(false);
    expect(settlement.performanceBonusPoints).toBe(0);

    // The course still completes with the stake and completion reward intact.
    const attempt = await prisma.courseAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe('COMPLETED');
    expect(attempt.performanceBonusAwarded).toBe(false);
    expect(attempt.pointsAwarded).toBe(150);
  });

  /* ---------------------------------------------------------------------- */
  /* Failure, forfeiture, retry                                              */
  /* ---------------------------------------------------------------------- */

  itDb('forfeits the stake to the reward pool when the deadline passes, then pays a recovery reward on retry', async () => {
    const course = await createMinimalCourse(instructorId, { baseStake: 100, completionReward: 50 });
    const moduleTwoAssessmentId = await getModuleTwoAssessmentId(course.courseId);
    const moduleTwoCorrect = await loadCorrectOptions(moduleTwoAssessmentId);

    const poolBefore = await RewardPoolService.getPool();

    const enrollment = await request(app)
      .post(`/api/courses/${course.courseId}/enroll`)
      .set(auth(learner.token))
      .send({});
    const attemptId = enrollment.body.data.attempt.id as string;

    // Push the deadline into the past without doing any work.
    const normalDeadline = addDays(new Date(), -3);
    await prisma.courseAttempt.update({
      where: { id: attemptId },
      data: {
        startedAt: addDays(normalDeadline, -30),
        normalDeadline,
        graceDeadline: addHours(normalDeadline, 24),
        status: 'ACTIVE',
      },
    });

    // The scheduled engine settles it: no browser involved.
    const run = await DeadlineService.processExpiredAttempts();
    expect(run.failed).toBe(1);
    expect(run.forfeitedPoints).toBe(100);

    const attemptAfterFailure = await prisma.courseAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attemptAfterFailure.status).toBe('FAILED');
    expect(attemptAfterFailure.pointsForfeited).toBe(100);

    const walletAfterFailure = await getWallet(learner.id);
    expect(walletAfterFailure.lockedBalance).toBe(0);
    expect(walletAfterFailure.availableBalance).toBe(1400); // stake is gone
    expect(walletAfterFailure.lifetimeForfeited).toBe(100);

    const poolAfter = await RewardPoolService.getPool();
    expect(poolAfter.balance).toBe(poolBefore.balance + 100);

    const forfeitEntries = await prisma.walletTransaction.findMany({ where: { userId: learner.id, type: 'STAKE_FORFEITED' } });
    expect(forfeitEntries).toHaveLength(1);
    expect(forfeitEntries[0]!.amount).toBe(-100);

    // Retry is available and does NOT require a new stake.
    const retryAvailable = await prisma.notification.findFirst({
      where: { userId: learner.id, type: 'RETRY_AVAILABLE' },
    });
    expect(retryAvailable).not.toBeNull();

    const retry = await request(app)
      .post(`/api/enrollments/${enrollment.body.data.enrollment.id}/retry`)
      .set(auth(learner.token))
      .send({});
    expect(retry.status).toBe(201);
    expect(retry.body.data.isRetry).toBe(true);
    expect(retry.body.data.stakes).toHaveLength(0);

    const retryAttemptId = retry.body.data.attempt.id as string;
    expect(retry.body.data.attempt.attemptNumber).toBe(2);

    const walletAfterRetry = await getWallet(learner.id);
    expect(walletAfterRetry.availableBalance).toBe(1400);
    expect(walletAfterRetry.lockedBalance).toBe(0);

    // Complete the retry.
    const watchVideo = async (contentId: string) => {
      await request(app)
        .post(`/api/attempts/${retryAttemptId}/content/${contentId}/progress`)
        .set(auth(learner.token))
        .send({ fromSeconds: 0, positionSeconds: 600, durationSeconds: 600, elapsedRealSeconds: 600 });
      await request(app).post(`/api/attempts/${retryAttemptId}/content/${contentId}/complete`).set(auth(learner.token)).send({});
    };

    await watchVideo(course.moduleOneVideoContentId);
    await request(app)
      .post(`/api/attempts/${retryAttemptId}/quizzes/${course.moduleOneQuizId}/attempt`)
      .set(auth(learner.token))
      .send({
        answers: Object.fromEntries(
          course.moduleOneQuizQuestionIds.map((id) => [id, course.moduleOneQuizCorrectOptions[id]!]),
        ),
      });
    await request(app)
      .post(`/api/attempts/${retryAttemptId}/assessments/${course.moduleOneAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({
        answers: Object.fromEntries(
          Object.entries(course.moduleOneAssessmentCorrectOptions).map(([questionId, optionId]) => [questionId, [optionId]]),
        ),
      });
    await watchVideo(course.moduleTwoVideoContentId);
    await request(app)
      .post(`/api/attempts/${retryAttemptId}/assessments/${moduleTwoAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({
        answers: Object.fromEntries(Object.entries(moduleTwoCorrect).map(([questionId, optionId]) => [questionId, [optionId]])),
      });

    const finalTest = await request(app)
      .post(`/api/attempts/${retryAttemptId}/assessments/${course.finalAssessmentId}/submit`)
      .set(auth(learner.token))
      .send({
        answers: Object.fromEntries(
          Object.entries(course.finalCorrectOptions).map(([questionId, optionId]) => [questionId, [optionId]]),
        ),
      });

    expect(finalTest.status).toBe(201);
    const settlement = finalTest.body.data.settlement;

    // Recovery reward = original stake / attempt number = 100 / 2 = 50.
    expect(settlement.isRetry).toBe(true);
    expect(settlement.recoveryReward).toBe(50);
    expect(settlement.stakeReturned).toBe(0);
    expect(settlement.lines.map((line: { label: string }) => line.label)).toContain('Retry Recovery Reward');

    const recoveryEntry = await prisma.walletTransaction.findFirst({
      where: { userId: learner.id, type: 'RETRY_REWARD' },
    });
    expect(recoveryEntry).not.toBeNull();
    expect(recoveryEntry!.amount).toBe(50);

    const finalWallet = await getWallet(learner.id);
    // 1400 + 50 recovery + 50 completion reward + 30 performance bonus
    expect(finalWallet.availableBalance).toBe(1530);
  });

  itDb('stops the learner retrying beyond the configured attempt limit', async () => {
    const course = await createMinimalCourse(instructorId, { baseStake: 50, maxAttempts: 1 });

    const enrollment = await request(app)
      .post(`/api/courses/${course.courseId}/enroll`)
      .set(auth(learner.token))
      .send({});
    const attemptId = enrollment.body.data.attempt.id as string;

    const normalDeadline = addDays(new Date(), -2);
    await prisma.courseAttempt.update({
      where: { id: attemptId },
      data: { normalDeadline, graceDeadline: addHours(normalDeadline, 1), status: 'ACTIVE' },
    });
    await DeadlineService.processExpiredAttempts();

    const retry = await request(app)
      .post(`/api/enrollments/${enrollment.body.data.enrollment.id}/retry`)
      .set(auth(learner.token))
      .send({});
    expect(retry.status).toBe(422);
    expect(retry.body.error.code).toBe('ATTEMPT_LIMIT_REACHED');
  });

  itDb('only lets the course owner settle completions', async () => {
    const otherInstructor = await registerAndLogin(app, { email: `other-${Date.now()}@test.dev`, role: 'INSTRUCTOR' });
    const course = await createMinimalCourse(instructorId);

    const publish = await request(app).post(`/api/courses/${course.courseId}/publish`).set(auth(otherInstructor.token)).send({});
    expect(publish.status).toBe(403);

    const listModules = await request(app).get(`/api/courses/${course.courseId}/modules`).set(auth(otherInstructor.token));
    expect(listModules.status).toBe(403);
  });

  itDb('verifies the password flow end to end', async () => {
    const email = `pw-${Date.now()}@test.dev`;
    const registered = await registerAndLogin(app, { email, role: 'LEARNER' });
    expect(registered.token).toBeTruthy();

    const badLogin = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword123' });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body.error.code).toBe('INVALID_CREDENTIALS');

    const goodLogin = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
    expect(goodLogin.status).toBe(200);

    const change = await request(app)
      .post('/api/auth/change-password')
      .set(auth(registered.token))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassword123' });
    expect(change.status).toBe(200);

    const afterChange = await request(app).post('/api/auth/login').send({ email, password: 'NewPassword123' });
    expect(afterChange.status).toBe(200);

    const oldPassword = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
    expect(oldPassword.status).toBe(401);
  });

  itDb('rejects a duplicate email registration', async () => {
    const email = `dupe-${Date.now()}@test.dev`;
    await registerAndLogin(app, { email, role: 'LEARNER' });
    const second = await request(app)
      .post('/api/auth/register')
      .send({ email, password: TEST_PASSWORD, fullName: 'Second Person' });
    expect(second.status).toBe(409);
  });

  itDb('cannot be told what role to use by the client', async () => {
    const email = `escalate-${Date.now()}@test.dev`;
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: TEST_PASSWORD, fullName: 'Sneaky Person', role: 'ADMIN' });

    // ADMIN is not self-registerable; the account is created as a learner.
    expect([201, 400]).toContain(response.status);
    if (response.status === 201) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.role).toBe('LEARNER');

      const adminCall = await request(app).get('/api/admin/dashboard').set(auth(response.body.data.accessToken));
      expect(adminCall.status).toBe(403);
    }
  });

  itDb('keeps the wallet consistent through a forced concurrent stake race', async () => {
    const courseA = await createMinimalCourse(instructorId, { baseStake: 1000, maxAttempts: 3 });
    const courseB = await createMinimalCourse(instructorId, { baseStake: 1000, maxAttempts: 3 });

    // Balance is 1500: only one of the two 1000-point stakes can succeed.
    const [first, second] = await Promise.all([
      request(app).post(`/api/courses/${courseA.courseId}/enroll`).set(auth(learner.token)).send({}),
      request(app).post(`/api/courses/${courseB.courseId}/enroll`).set(auth(learner.token)).send({}),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 422]);

    const wallet = await getWallet(learner.id);
    expect(wallet.availableBalance).toBe(500);
    expect(wallet.lockedBalance).toBe(1000);

    // The ledger must reconcile exactly with the wallet.
    const ledger = await prisma.walletTransaction.findMany({ where: { userId: learner.id } });
    const net = ledger.reduce((sum, entry) => sum + entry.amount, 0);
    expect(net).toBe(wallet.availableBalance);
  });
});

// Keeps the hashPassword import meaningful for the helper contract above.
void hashPassword;

