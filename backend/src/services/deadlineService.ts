import type { AttemptStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { computePacing, type PacingResult } from '../lib/pacing';
import { PACING } from '../config/constants';
import { LearningService } from './learningService';
import { StakeService } from './stakeService';
import { NotificationService } from './notificationService';
import { logger } from '../lib/logger';
import { addHours, daysRemaining, roundTo } from '../utils/date';

const OPEN_STATUSES: AttemptStatus[] = ['ACTIVE', 'AT_RISK', 'GRACE_PERIOD'];

export interface DeadlineRunSummary {
  scanned: number;
  completed: number;
  failed: number;
  skipped: number;
  forfeitedPoints: number;
  errors: Array<{ attemptId: string; message: string }>;
}

/**
 * Deadline engine.
 *
 * Runs on a schedule (see `jobs/scheduler.ts`) and is also callable on demand
 * by an admin. It never depends on a browser being open: attempts are settled
 * from the database state alone.
 */
export const DeadlineService = {
  /** Computes live pacing for one attempt (used by dashboards). */
  async getPacing(attemptId: string, userId: string): Promise<PacingResult> {
    const attempt = await prisma.courseAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new Error(`Unknown attempt ${attemptId}`);

    const progressMap = await LearningService.summarizeAttemptProgress([attemptId]);
    return computePacing({
      startedAt: attempt.startedAt,
      normalDeadline: attempt.normalDeadline,
      acceleratedDeadline: attempt.acceleratedDeadline,
      graceDeadline: attempt.graceDeadline,
      actualProgressPercent: progressMap.get(attemptId) ?? 0,
      atRiskThresholdPercent: env.AT_RISK_THRESHOLD_PERCENT,
      now: new Date(),
    });
  },

  /**
   * Step 1 — flag attempts that are behind expected progress and move
   * past-deadline attempts into GRACE_PERIOD. Also emits at-risk
   * notifications (once per attempt per day).
   */
  async scanAtRisk(now: Date = new Date()): Promise<{ scanned: number; atRisk: number; inGrace: number; notified: number }> {
    const attempts = await prisma.courseAttempt.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        userId: true,
        courseId: true,
        status: true,
        startedAt: true,
        normalDeadline: true,
        acceleratedDeadline: true,
        graceDeadline: true,
        course: { select: { title: true, baseStake: true } },
      },
      take: env.DEADLINE_JOB_BATCH_SIZE * 5,
    });

    if (attempts.length === 0) return { scanned: 0, atRisk: 0, inGrace: 0, notified: 0 };

    const progressMap = await LearningService.summarizeAttemptProgress(attempts.map((attempt) => attempt.id));

    let atRisk = 0;
    let inGrace = 0;
    let notified = 0;

    for (const attempt of attempts) {
      const pacing = computePacing({
        startedAt: attempt.startedAt,
        normalDeadline: attempt.normalDeadline,
        acceleratedDeadline: attempt.acceleratedDeadline,
        graceDeadline: attempt.graceDeadline,
        actualProgressPercent: progressMap.get(attempt.id) ?? 0,
        atRiskThresholdPercent: env.AT_RISK_THRESHOLD_PERCENT,
        now,
      });

      let nextStatus: AttemptStatus = 'ACTIVE';
      if (pacing.inGracePeriod) {
        nextStatus = 'GRACE_PERIOD';
        inGrace += 1;
      } else if (pacing.isAtRisk) {
        nextStatus = 'AT_RISK';
        atRisk += 1;
      }

      if (nextStatus !== attempt.status) {
        await prisma.courseAttempt.update({
          where: { id: attempt.id },
          data: { status: nextStatus, lastRiskCheckAt: now },
        });
      } else {
        await prisma.courseAttempt.update({ where: { id: attempt.id }, data: { lastRiskCheckAt: now } });
      }

      // Notify at-risk learners once per calendar day.
      if (nextStatus === 'AT_RISK') {
        const referenceId = `${attempt.id}:at-risk:${now.toISOString().slice(0, 10)}`;
        const alreadySent = await NotificationService.alreadySent(attempt.userId, 'AT_RISK', referenceId);
        if (!alreadySent) {
          await NotificationService.notifySafely({
            userId: attempt.userId,
            type: 'AT_RISK',
            title: 'Course at risk',
            message: `You are ${pacing.gap.toFixed(0)} points behind expected progress in ${attempt.course.title} with ${daysRemaining(attempt.normalDeadline, now)} day(s) left. ${roundTo(attempt.course.baseStake, 0)} points are at stake.`,
            link: `/my-courses`,
            metadata: { referenceId },
          });
          notified += 1;
        }
      }

      if (nextStatus === 'GRACE_PERIOD') {
        const referenceId = `${attempt.id}:grace:${now.toISOString().slice(0, 10)}`;
        const alreadySent = await NotificationService.alreadySent(attempt.userId, 'DEADLINE_APPROACHING', referenceId);
        if (!alreadySent) {
          await NotificationService.notifySafely({
            userId: attempt.userId,
            type: 'DEADLINE_APPROACHING',
            title: 'Final warning — grace period active',
            message: `${attempt.course.title} is past its deadline. You have ${pacing.hoursUntilForfeiture.toFixed(1)} hour(s) of grace remaining before the stake is forfeited.`,
            link: `/my-courses`,
            metadata: { referenceId },
          });
          notified += 1;
        }
      }
    }

    logger.info({ scanned: attempts.length, atRisk, inGrace, notified }, 'at-risk scan completed');
    return { scanned: attempts.length, atRisk, inGrace, notified };
  },

  /** Step 2 — settle every attempt whose grace deadline has elapsed. */
  async processExpiredAttempts(now: Date = new Date()): Promise<DeadlineRunSummary> {
    const expired = await prisma.courseAttempt.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        graceDeadline: { lte: now },
      },
      select: { id: true },
      take: env.DEADLINE_JOB_BATCH_SIZE,
      orderBy: { graceDeadline: 'asc' },
    });

    const summary: DeadlineRunSummary = {
      scanned: expired.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      forfeitedPoints: 0,
      errors: [],
    };

    for (const attempt of expired) {
      try {
        const result = await StakeService.settleAttemptAtDeadline(attempt.id);
        if (result.outcome === 'COMPLETED') summary.completed += 1;
        else if (result.outcome === 'FAILED') {
          summary.failed += 1;
          summary.forfeitedPoints += result.forfeitedPoints;
        } else summary.skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push({ attemptId: attempt.id, message });
        logger.error({ err: error, attemptId: attempt.id }, 'deadline settlement failed');
      }
    }

    logger.info(summary, 'deadline settlement run completed');
    return summary;
  },

  /** Step 3 — reminders at 72h / 24h / 6h / 1h before the binding deadline. */
  async sendDeadlineReminders(now: Date = new Date()): Promise<{ sent: number }> {
    const horizon = addHours(now, Math.max(...PACING.deadlineReminderHours) + 1);

    const attempts = await prisma.courseAttempt.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        normalDeadline: { gt: now, lte: horizon },
      },
      select: {
        id: true,
        userId: true,
        normalDeadline: true,
        acceleratedDeadline: true,
        course: { select: { title: true, baseStake: true } },
      },
      take: env.DEADLINE_JOB_BATCH_SIZE,
    });

    let sent = 0;

    for (const attempt of attempts) {
      const hoursLeft = (attempt.normalDeadline.getTime() - now.getTime()) / 3_600_000;
      const threshold = [...PACING.deadlineReminderHours].sort((a, b) => a - b).find((value) => hoursLeft <= value);
      if (threshold === undefined) continue;

      const referenceId = `${attempt.id}:reminder:${threshold}`;
      const alreadySent = await NotificationService.alreadySent(attempt.userId, 'DEADLINE_APPROACHING', referenceId);
      if (alreadySent) continue;

      await NotificationService.notifySafely({
        userId: attempt.userId,
        type: 'DEADLINE_APPROACHING',
        title: `${threshold}h left to complete ${attempt.course.title}`,
        message: `Your deadline is in ${hoursLeft.toFixed(1)} hours. ${attempt.course.baseStake} points are staked on verified completion.`,
        link: '/my-courses',
        metadata: { referenceId },
      });
      sent += 1;

      // Separate nudge for the optional accelerated deadline.
      if (attempt.acceleratedDeadline) {
        const acceleratedHoursLeft = (attempt.acceleratedDeadline.getTime() - now.getTime()) / 3_600_000;
        const acceleratedReference = `${attempt.id}:accelerated:${threshold}`;
        if (acceleratedHoursLeft > 0 && acceleratedHoursLeft <= threshold) {
          const sentAccelerated = await NotificationService.alreadySent(
            attempt.userId,
            'ACCELERATED_DEADLINE',
            acceleratedReference,
          );
          if (!sentAccelerated) {
            await NotificationService.notifySafely({
              userId: attempt.userId,
              type: 'ACCELERATED_DEADLINE',
              title: 'Accelerated deadline approaching',
              message: `Your chosen accelerated deadline for ${attempt.course.title} is in ${acceleratedHoursLeft.toFixed(1)} hours. Missing it only forfeits the bonus — your course stays active.`,
              link: '/my-courses',
              metadata: { referenceId: acceleratedReference },
            });
            sent += 1;
          }
        }
      }
    }

    logger.info({ sent }, 'deadline reminders dispatched');
    return { sent };
  },
};
