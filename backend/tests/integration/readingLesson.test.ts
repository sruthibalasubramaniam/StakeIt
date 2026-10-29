import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/lib/prisma';
import { RewardPoolService } from '../../src/services/rewardPoolService';
import {
  INTEGRATION_TEST_TIMEOUT_MS,
  buildTestApp,
  isDatabaseAvailable,
  registerAndLogin,
  resetDatabase,
  type TestUser,
} from './helpers';

/**
 * Structured reading lessons, end to end.
 *
 * These tests exist to prove the *server* enforces the MOOC rules, because the
 * reader is only a renderer:
 *   - a draft lesson is invisible to learners,
 *   - sections unlock strictly in order,
 *   - a checkpoint-guarded section cannot be completed without passing,
 *   - the lesson cannot be completed while sections are outstanding,
 *   - completing twice does not create a second progress record,
 *   - another learner cannot drive someone else's attempt,
 *   - positions survive across requests (resume from another device).
 *
 * NOTE: this suite truncates the database (see `resetDatabase`). Point
 * `TEST_DATABASE_URL` at a throwaway database before running it.
 */
describe('MOOC reading lessons', () => {
  let app: Express;
  let instructor: TestUser;
  let learner: TestUser;
  let otherLearner: TestUser;
  let dbAvailable = false;

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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) return;
    app = buildTestApp();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await resetDatabase();
    await RewardPoolService.ensurePool(prisma);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    instructor = await registerAndLogin(app, { email: `reader-instructor-${suffix}@test.dev`, role: 'INSTRUCTOR' });
    learner = await registerAndLogin(app, { email: `reader-learner-${suffix}@test.dev`, role: 'LEARNER' });
    otherLearner = await registerAndLogin(app, { email: `reader-other-${suffix}@test.dev`, role: 'LEARNER' });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await resetDatabase();
    await prisma.$disconnect();
  });

  /**
   * One-module course whose only content is the reading lesson, so the reader is
   * the first unlocked item and the test is about reading rules, not about
   * grinding through a video and a quiz first.
   */
  async function createReadingCourse(params: { published?: boolean } = {}) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const course = await prisma.course.create({
      data: {
        code: `RD-${Math.floor(Math.random() * 9000) + 1000}`,
        slug: `reading-course-${suffix}`,
        title: 'Reading Course',
        shortDescription: 'Fixture for the MOOC reader.',
        description: 'Fixture course used by the reading integration suite.',
        category: 'Testing',
        difficulty: 'BEGINNER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        instructorId: instructor.id,
        baseStake: 100,
        completionReward: 50,
        commitmentBonus: 40,
        performanceBonus: 30,
        performanceThreshold: 85,
        durationDays: 30,
        gracePeriodHours: 24,
        moduleWeight: 70,
        finalTestWeight: 30,
        moduleQuizWeight: 40,
        moduleAssessmentWeight: 60,
        maxAttempts: 3,
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
                    type: 'READING',
                    title: 'Pairs trading primer',
                    orderIndex: 0,
                    isRequired: true,
                    readingObjectives: ['Explain cointegration', 'Size a spread trade'],
                    readingPublishedAt: params.published === false ? null : new Date(),
                    readingSections: {
                      create: [
                        {
                          title: 'Why pairs trade',
                          bodyHtml: '<p>Relative value basics.</p>',
                          orderIndex: 0,
                        },
                        {
                          title: 'Cointegration',
                          bodyHtml: '<p>Engle-Granger in practice.</p>',
                          orderIndex: 1,
                        },
                        {
                          title: 'Execution',
                          bodyHtml: '<p>Fills, slippage and exits.</p>',
                          orderIndex: 2,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      include: {
        modules: { include: { contents: { include: { readingSections: { include: { checkpoint: true } } } } } },
      },
    });

    const content = course.modules[0]!.contents[0]!;
    const sections = [...content.readingSections].sort((a, b) => a.orderIndex - b.orderIndex);

    // The guarded section's checkpoint is created after the course so it can
    // carry the real content id (no placeholder rows anywhere in the fixture).
    await prisma.readingCheckpoint.create({
      data: {
        contentId: content.id,
        sectionId: sections[1]!.id,
        title: 'Cointegration check',
        passingScore: 100,
        questions: {
          create: [
            {
              type: 'SINGLE_CHOICE',
              prompt: 'What does cointegration imply?',
              points: 1,
              orderIndex: 0,
              explanation: 'A stable long-run spread.',
              options: {
                create: [
                  { label: 'A stable long-run spread', isCorrect: true, orderIndex: 0 },
                  { label: 'Zero correlation', isCorrect: false, orderIndex: 1 },
                ],
              },
            },
            {
              type: 'SINGLE_CHOICE',
              prompt: 'Which test is commonly used?',
              points: 1,
              orderIndex: 1,
              options: {
                create: [
                  { label: 'Engle-Granger', isCorrect: true, orderIndex: 0 },
                  { label: 'Shapiro-Wilk', isCorrect: false, orderIndex: 1 },
                ],
              },
            },
          ],
        },
      },
    });

    return {
      courseId: course.id,
      contentId: content.id,
      sectionIds: sections.map((section) => section.id),
    };
  }

  async function enroll(userToken: string, courseId: string, userId: string) {
    const response = await request(app).post(`/api/courses/${courseId}/enroll`).set(auth(userToken)).send({});
    expect([200, 201]).toContain(response.status);
    const attempt = await prisma.courseAttempt.findFirstOrThrow({
      where: { enrollment: { courseId, userId } },
      orderBy: { createdAt: 'desc' },
    });
    return attempt.id;
  }

  async function checkpointFixture(contentId: string) {
    const checkpoint = await prisma.readingCheckpoint.findFirstOrThrow({
      where: { contentId },
      include: { questions: { include: { options: true } } },
    });
    const correct: Record<string, string[]> = {};
    for (const question of checkpoint.questions) {
      correct[question.id] = [question.options.find((option) => option.isCorrect)!.id];
    }
    return { checkpointId: checkpoint.id, correct };
  }

  /* ---------------------------------------------------------------------- */

  itDb('hides a draft lesson from learners but keeps it editable for the instructor', async () => {
    const fixture = await createReadingCourse({ published: false });
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);

    const asLearner = await request(app)
      .get(`/api/attempts/${attemptId}/content/${fixture.contentId}`)
      .set(auth(learner.token));
    expect(asLearner.status).toBe(422);
    expect(asLearner.body.error.code).toBe('CONTENT_LOCKED');
    expect(asLearner.body.error.details).toMatchObject({ reason: 'NOT_PUBLISHED' });

    const draft = await request(app)
      .get(`/api/content/${fixture.contentId}/reading`)
      .set(auth(instructor.token));
    expect(draft.status).toBe(200);
    expect(draft.body.data.sections).toHaveLength(3);
    expect(draft.body.data.content.published).toBe(false);
  });

  itDb('rejects progress writes against a draft lesson even with a valid section id', async () => {
    const fixture = await createReadingCourse({ published: false });
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first] = fixture.sectionIds;

    const response = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${first}/complete`)
      .set(auth(learner.token))
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.error.details).toMatchObject({ reason: 'NOT_PUBLISHED' });
    expect(await prisma.readingSectionProgress.count({ where: { attemptId } })).toBe(0);
  });

  itDb('refuses learner access to the authoring endpoints', async () => {
    const fixture = await createReadingCourse();
    const response = await request(app).get(`/api/content/${fixture.contentId}/reading`).set(auth(learner.token));
    expect(response.status).toBe(403);
  });

  itDb('unlocks sections strictly in order and never returns locked bodies', async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);

    const view = await request(app)
      .get(`/api/attempts/${attemptId}/content/${fixture.contentId}`)
      .set(auth(learner.token));
    expect(view.status).toBe(200);

    const { sections } = view.body.data.payload;
    expect(sections[0].isUnlocked).toBe(true);
    expect(sections[0].bodyHtml).toContain('Relative value');
    expect(sections[1].isUnlocked).toBe(false);
    expect(sections[1].bodyHtml).toBeNull();
    expect(sections[2].isUnlocked).toBe(false);
  });

  itDb('rejects a try to complete a locked section or skip the checkpoint', async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first, second] = fixture.sectionIds;

    const locked = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${second}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('CONTENT_LOCKED');

    const firstOk = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${first}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(firstOk.status).toBe(200);
    expect(firstOk.body.data.lesson.canCompleteLesson).toBe(false);

    // Section 2 is checkpoint-guarded: marking it read must not be accepted.
    const withoutCheckpoint = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${second}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(withoutCheckpoint.status).toBe(422);
    expect(withoutCheckpoint.body.error.code).toBe('CHECKPOINT_REQUIRED');
  });

  itDb('fails a wrong checkpoint answer, then unlocks the next section when passed', async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first, second, third] = fixture.sectionIds;
    const { checkpointId, correct } = await checkpointFixture(fixture.contentId);

    await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${first}/complete`)
      .set(auth(learner.token))
      .send({})
      .expect(200);

    const wrongAnswers = Object.fromEntries(
      Object.entries(correct).map(([questionId]) => [questionId, ['00000000-0000-0000-0000-000000000000']]),
    );
    const failed = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/checkpoints/${checkpointId}/submit`)
      .set(auth(learner.token))
      .send({ answers: wrongAnswers });
    expect(failed.status).toBe(201);
    expect(failed.body.data.passed).toBe(false);
    expect(failed.body.data.results).toEqual([]); // answer key stays hidden on failure

    const stillLocked = await request(app)
      .get(`/api/attempts/${attemptId}/content/${fixture.contentId}`)
      .set(auth(learner.token));
    expect(stillLocked.body.data.payload.sections[2].isUnlocked).toBe(false);

    const passed = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/checkpoints/${checkpointId}/submit`)
      .set(auth(learner.token))
      .send({ answers: correct });
    expect(passed.status).toBe(201);
    expect(passed.body.data.passed).toBe(true);
    expect(passed.body.data.percentage).toBe(100);

    const unlocked = await request(app)
      .get(`/api/attempts/${attemptId}/content/${fixture.contentId}`)
      .set(auth(learner.token));
    expect(unlocked.body.data.payload.sections[1].isCompleted).toBe(true);
    expect(unlocked.body.data.payload.sections[2].isUnlocked).toBe(true);

    await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${third}/complete`)
      .set(auth(learner.token))
      .send({})
      .expect(200);
  });

  itDb('refuses lesson completion while sections remain, then records it once', async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first, second, third] = fixture.sectionIds;
    const { checkpointId, correct } = await checkpointFixture(fixture.contentId);

    const premature = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(premature.status).toBe(422);
    expect(premature.body.error.code).toBe('INVALID_PROGRESS');

    for (const sectionId of [first]) {
      await request(app)
        .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${sectionId}/complete`)
        .set(auth(learner.token))
        .send({})
        .expect(200);
    }
    await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/checkpoints/${checkpointId}/submit`)
      .set(auth(learner.token))
      .send({ answers: correct })
      .expect(201);
    await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${third}/complete`)
      .set(auth(learner.token))
      .send({})
      .expect(200);

    const completed = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/complete`)
      .set(auth(learner.token))
      .send({});
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');

    // Idempotent: a second call must not create another record.
    await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/complete`)
      .set(auth(learner.token))
      .send({})
      .expect(200);

    const records = await prisma.contentProgress.findMany({
      where: { attemptId, contentId: fixture.contentId },
      include: { attempt: true },
    });
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('COMPLETED');
    expect(records[0]!.readingSectionsDone).toBe(3);
    expect(records[0]!.readingCompletedVersion).toBeGreaterThanOrEqual(1);
  });

  itDb('persists the reading position across requests', async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first] = fixture.sectionIds;

    const saved = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/position`)
      .set(auth(learner.token))
      .send({ sectionId: first, pdfPage: 7, activeSeconds: 30 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.lastPdfPage).toBe(7);

    // A fresh request (a different device, in effect) gets the same position back.
    const view = await request(app)
      .get(`/api/attempts/${attemptId}/content/${fixture.contentId}`)
      .set(auth(learner.token));
    expect(view.body.data.payload.resume.pdfPage).toBe(7);
    expect(view.body.data.payload.resume.sectionId).toBe(first);
  });

  itDb("denies progress writes against another learner's attempt", async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first] = fixture.sectionIds;

    const response = await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${first}/complete`)
      .set(auth(otherLearner.token))
      .send({});

    expect([403, 404]).toContain(response.status);
    const records = await prisma.readingSectionProgress.count({ where: { attemptId } });
    expect(records).toBe(0);
  });

  itDb('keeps completed sections when an instructor edits published content', async () => {
    const fixture = await createReadingCourse();
    const attemptId = await enroll(learner.token, fixture.courseId, learner.id);
    const [first] = fixture.sectionIds;

    await request(app)
      .post(`/api/attempts/${attemptId}/content/${fixture.contentId}/reading/sections/${first}/complete`)
      .set(auth(learner.token))
      .send({})
      .expect(200);

    const edited = await request(app)
      .put(`/api/content/${fixture.contentId}/reading/sections/${first}`)
      .set(auth(instructor.token))
      .send({ title: 'Why pairs trade (revised)', bodyHtml: '<p>Updated prose.</p>' });
    expect(edited.status).toBe(200);

    const progress = await prisma.readingSectionProgress.findFirstOrThrow({
      where: { attemptId, sectionId: first },
    });
    expect(progress.isCompleted).toBe(true);

    const list = await request(app)
      .get(`/api/content/${fixture.contentId}/reading`)
      .set(auth(instructor.token));
    expect(list.body.data.content.version).toBeGreaterThan(1);
  });

  itDb('blocks publishing a lesson with an empty section and sanitises stored HTML', async () => {
    const fixture = await createReadingCourse({ published: false });

    const created = await request(app)
      .post(`/api/content/${fixture.contentId}/reading/sections`)
      .set(auth(instructor.token))
      .send({ title: 'Dangerous', bodyHtml: '<p onclick="steal()">ok</p><script>alert(1)</script>' });
    expect(created.status).toBe(201);
    expect(created.body.data.bodyHtml).not.toContain('script');
    expect(created.body.data.bodyHtml).not.toContain('onclick');

    const emptied = await request(app)
      .put(`/api/content/${fixture.contentId}/reading/sections/${fixture.sectionIds[0]}`)
      .set(auth(instructor.token))
      .send({ bodyHtml: '' });
    expect(emptied.status).toBe(200);

    const publish = await request(app)
      .post(`/api/content/${fixture.contentId}/reading/publish`)
      .set(auth(instructor.token))
      .send({});
    expect(publish.status).toBe(422);
    expect(publish.body.error.details.issues.length).toBeGreaterThan(0);
  });
});
