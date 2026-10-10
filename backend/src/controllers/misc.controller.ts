import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { NotificationService } from '../services/notificationService';
import { ReputationService } from '../services/reputationService';
import { RecommendationService } from '../services/recommendationService';
import { CourseService } from '../services/courseService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const NotificationController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await NotificationService.list(userId, req.query as never);
    res.status(200).json({ data: result });
  }),

  unreadCount: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const count = await NotificationService.unreadCount(userId);
    res.status(200).json({ data: { unreadCount: count } });
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await NotificationService.markRead(userId, req.params.id as string);
    res.status(200).json({ data: result });
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const updated = await NotificationService.markAllRead(userId);
    res.status(200).json({ data: { updated } });
  }),
};

export const ReviewController = {
  /**
   * Reviews are only accepted from learners who actually completed the course —
   * that is what makes the rating meaningful for instructor reputation.
   */
  create: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const courseId = req.params.id as string;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw notFound('Course');

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: { attempts: { where: { status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } } },
    });

    if (!enrollment || enrollment.status !== 'COMPLETED' || enrollment.attempts.length === 0) {
      throw forbidden('Only learners who completed the course can review it.');
    }

    const existing = await prisma.courseReview.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) {
      throw conflict('You have already reviewed this course.', 'CONFLICT', { reviewId: existing.id });
    }

    const review = await prisma.courseReview.create({
      data: {
        courseId,
        userId,
        enrollmentId: enrollment.id,
        rating: req.body.rating,
        difficultyRating: req.body.difficultyRating ?? null,
        wouldRecommend: req.body.wouldRecommend ?? true,
        reviewText: req.body.reviewText ?? null,
      },
    });

    // A new rating can shift the instructor's reputation tier.
    await ReputationService.syncBadge(course.instructorId).catch(() => undefined);

    res.status(201).json({ data: review });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const review = await prisma.courseReview.findUnique({ where: { id: req.params.id as string } });
    if (!review) throw notFound('Review');
    if (review.userId !== userId) throw forbidden('You can only edit your own review.');

    const updated = await prisma.courseReview.update({
      where: { id: review.id },
      data: {
        ...(req.body.rating !== undefined ? { rating: req.body.rating } : {}),
        ...(req.body.difficultyRating !== undefined ? { difficultyRating: req.body.difficultyRating } : {}),
        ...(req.body.wouldRecommend !== undefined ? { wouldRecommend: req.body.wouldRecommend } : {}),
        ...(req.body.reviewText !== undefined ? { reviewText: req.body.reviewText } : {}),
      },
    });

    const course = await prisma.course.findUnique({ where: { id: review.courseId }, select: { instructorId: true } });
    if (course) await ReputationService.syncBadge(course.instructorId).catch(() => undefined);

    res.status(200).json({ data: updated });
  }),

  listForCourse: asyncHandler(async (req: Request, res: Response) => {
    // The route accepts a UUID, slug or course code, so resolve it first —
    // otherwise the review query would silently match nothing for a slug.
    const courseId = await CourseService.resolveId(req.params.id as string);
    if (!courseId) throw notFound('Course');

    const reviews = await prisma.courseReview.findMany({
      where: { courseId, isPublished: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
    });

    const average = reviews.length
      ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 100) / 100
      : null;

    res.status(200).json({ data: { reviews, average, count: reviews.length } });
  }),

  mine: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const reviews = await prisma.courseReview.findMany({
      where: { userId },
      include: { course: { select: { id: true, title: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ data: reviews });
  }),
};

export const ProfileController = {
  /** Public instructor profile with reputation, badges and course catalogue. */
  instructor: asyncHandler(async (req: Request, res: Response) => {
    const instructorId = req.params.id as string;
    const instructor = await prisma.user.findUnique({
      where: { id: instructorId },
      select: {
        id: true,
        fullName: true,
        headline: true,
        bio: true,
        avatarUrl: true,
        expertise: true,
        createdAt: true,
      },
    });
    if (!instructor) throw notFound('Instructor');

    const [reputation, badges, courses] = await Promise.all([
      ReputationService.getPublicReputation(instructorId),
      ReputationService.getBadgeHistory(instructorId),
      prisma.course.findMany({
        where: { instructorId, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        include: {
          instructor: { select: { id: true, fullName: true, headline: true, avatarUrl: true, bio: true, expertise: true, badges: true, _count: { select: { coursesTaught: true } } } },
          _count: { select: { enrollments: true, modules: true } },
          reviews: { where: { isPublished: true }, select: { rating: true, difficultyRating: true, wouldRecommend: true } },
        },
      }),
    ]);

    res.status(200).json({ data: { instructor, reputation, badges, courses } });
  }),

  /** Mounted as `GET /api/courses/:id/recommendation`. */
  recommendation: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const result = await RecommendationService.recommendForCourse(userId, req.params.id as string);
    res.status(200).json({ data: result });
  }),
};

export const HealthController = {
  check: asyncHandler(async (_req: Request, res: Response) => {
    let database = 'down';
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const healthy = database === 'up';
    res.status(healthy ? 200 : 503).json({
      data: {
        status: healthy ? 'ok' : 'degraded',
        database,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  }),
};

export const CatalogueController = {
  /** Course list with the viewer's enrolment state attached (learner catalogue). */
  browse: asyncHandler(async (req: Request, res: Response) => {
    const result = await CourseService.list(req.query as never, req.auth);

    if (!req.auth) {
      res.status(200).json({ data: result });
      return;
    }

    const courseIds = (result.items as Array<{ id: string }>).map((item) => item.id);
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.auth.userId, courseId: { in: courseIds } },
      select: { id: true, courseId: true, status: true, attemptCount: true },
    });

    const byCourse = new Map(enrollments.map((enrollment) => [enrollment.courseId, enrollment]));

    res.status(200).json({
      data: {
        ...result,
        items: (result.items as Array<Record<string, unknown>>).map((item) => ({
          ...item,
          enrollment: byCourse.get(item.id as string) ?? null,
        })),
      },
    });
  }),
};

