import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/lib/prisma';
import { RewardPoolService } from '../../src/services/rewardPoolService';
import {
  INTEGRATION_TEST_TIMEOUT_MS,
  buildTestApp,
  createMinimalCourse,
  isDatabaseAvailable,
  registerAndLogin,
  resetDatabase,
  type TestUser,
} from './helpers';

/**
 * Regression guard for the course detail payload.
 *
 * The detail screen picks between "Resume course", "View completion receipt" and
 * "Enrol & stake" purely from `enrollment` on this response. The field was never
 * populated, so a learner who was already enrolled — or already finished — was
 * always offered the staking form.
 *
 * NOTE: this suite truncates the database (see `resetDatabase`). Point
 * `TEST_DATABASE_URL` at a throwaway database before running it.
 */
describe('GET /api/courses/:idOrSlug — viewer enrolment', () => {
  let app: Express;
  let learner: TestUser;
  let instructor: TestUser;
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

  const slugOf = async (courseId: string) =>
    (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { slug: true } })).slug;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) return;
    app = buildTestApp();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await resetDatabase();
    await RewardPoolService.ensurePool(prisma);

    instructor = await registerAndLogin(app, { email: `instructor-${Date.now()}@test.dev`, role: 'INSTRUCTOR' });
    learner = await registerAndLogin(app, { email: `learner-${Date.now()}@test.dev`, role: 'LEARNER' });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await resetDatabase();
    await prisma.$disconnect();
  });

  itDb('is null for every audience before anyone enrols', async () => {
    const course = await createMinimalCourse(instructor.id);
    const slug = await slugOf(course.courseId);

    const asLearner = await request(app).get(`/api/courses/${slug}`).set(auth(learner.token));
    expect(asLearner.status).toBe(200);
    expect(asLearner.body.data.enrollment).toBeNull();

    // An instructor browsing the catalogue must not be handed a learner's state.
    const asInstructor = await request(app).get(`/api/courses/${slug}`).set(auth(instructor.token));
    expect(asInstructor.status).toBe(200);
    expect(asInstructor.body.data.enrollment).toBeNull();

    const anonymous = await request(app).get(`/api/courses/${slug}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data.enrollment).toBeNull();
  });

  itDb('reports ACTIVE for the enrolled learner, addressed by slug and by id', async () => {
    const course = await createMinimalCourse(instructor.id);
    const slug = await slugOf(course.courseId);

    const enrollment = await request(app).post(`/api/courses/${course.courseId}/enroll`).set(auth(learner.token)).send({});
    expect(enrollment.status).toBe(201);
    const enrollmentId = enrollment.body.data.enrollment.id as string;

    // Every UI link uses the slug.
    const bySlug = await request(app).get(`/api/courses/${slug}`).set(auth(learner.token));
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.data.enrollment).toMatchObject({ id: enrollmentId, status: 'ACTIVE' });

    const byId = await request(app).get(`/api/courses/${course.courseId}`).set(auth(learner.token));
    expect(byId.status).toBe(200);
    expect(byId.body.data.enrollment?.id).toBe(enrollmentId);
  });

  itDb('still reports the enrolment once the learner has completed the course', async () => {
    const course = await createMinimalCourse(instructor.id);
    const slug = await slugOf(course.courseId);

    const enrollment = await request(app).post(`/api/courses/${course.courseId}/enroll`).set(auth(learner.token)).send({});
    const enrollmentId = enrollment.body.data.enrollment.id as string;

    await prisma.enrollment.update({ where: { id: enrollmentId }, data: { status: 'COMPLETED' } });

    const response = await request(app).get(`/api/courses/${slug}`).set(auth(learner.token));
    expect(response.status).toBe(200);
    expect(response.body.data.enrollment).toMatchObject({ id: enrollmentId, status: 'COMPLETED' });
  });

  itDb('never leaks one learner’s enrolment to another account', async () => {
    const course = await createMinimalCourse(instructor.id);
    const slug = await slugOf(course.courseId);

    await request(app).post(`/api/courses/${course.courseId}/enroll`).set(auth(learner.token)).send({});

    const other = await registerAndLogin(app, { email: `other-${Date.now()}@test.dev`, role: 'LEARNER' });
    const response = await request(app).get(`/api/courses/${slug}`).set(auth(other.token));

    expect(response.status).toBe(200);
    expect(response.body.data.enrollment).toBeNull();
  });
});
