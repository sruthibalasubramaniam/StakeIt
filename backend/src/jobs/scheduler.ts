import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { JOB_NAMES } from '../config/constants';
import { logger } from '../lib/logger';
import { DeadlineService } from '../services/deadlineService';
import { ReputationService } from '../services/reputationService';

/**
 * Scheduled maintenance.
 *
 * These jobs are the reason a learner never has to have the browser open for a
 * deadline to be enforced: the API process itself settles expired attempts,
 * recalculates at-risk pacing and refreshes instructor reputation.
 *
 * Each job guards against overlapping runs and never throws into the process.
 */
const tasks: ScheduledTask[] = [];
let running = new Set<string>();

async function guard(name: string, handler: () => Promise<unknown>): Promise<void> {
  if (running.has(name)) {
    logger.warn({ job: name }, 'skipping run — previous execution still in progress');
    return;
  }
  running.add(name);
  const startedAt = Date.now();
  try {
    const result = await handler();
    logger.info({ job: name, durationMs: Date.now() - startedAt, result }, 'scheduled job finished');
  } catch (error) {
    logger.error({ err: error, job: name }, 'scheduled job failed');
  } finally {
    running.delete(name);
  }
}

export interface SchedulerDefinition {
  name: string;
  expression: string;
  description: string;
  run: () => Promise<unknown>;
}

/**
 * Job definitions are exported so tests (and the admin "run now" endpoint) can
 * invoke the exact same logic without waiting for a cron tick.
 */
export const schedulerDefinitions: SchedulerDefinition[] = [
  {
    name: JOB_NAMES.deadlineSettlement,
    // Every 5 minutes: settle attempts whose grace period has elapsed.
    expression: '*/5 * * * *',
    description: 'Settle expired course attempts (success or forfeiture)',
    run: () => DeadlineService.processExpiredAttempts(),
  },
  {
    name: JOB_NAMES.atRiskScan,
    // Every 15 minutes: refresh pacing and flag at-risk learners.
    expression: '*/15 * * * *',
    description: 'Recompute pacing and flag AT_RISK attempts',
    run: () => DeadlineService.scanAtRisk(),
  },
  {
    name: JOB_NAMES.deadlineReminders,
    // Hourly at :07: emit 72h/24h/6h/1h reminders idempotently.
    expression: '7 * * * *',
    description: 'Dispatch deadline and accelerated-deadline reminders',
    run: () => DeadlineService.sendDeadlineReminders(),
  },
  {
    name: JOB_NAMES.reputationRecompute,
    // Nightly at 02:15: refresh instructor reputation tiers.
    expression: '15 2 * * *',
    description: 'Recompute instructor reputation badges',
    run: () => ReputationService.recomputeAllBadges(),
  },
];

export function startScheduler(): void {
  if (!env.SCHEDULER_ENABLED) {
    logger.info('scheduler disabled (SCHEDULER_ENABLED=false)');
    return;
  }

  for (const definition of schedulerDefinitions) {
    const task = cron.schedule(
      definition.expression,
      () => {
        void guard(definition.name, definition.run);
      },
      { timezone: process.env.TZ ?? 'UTC' },
    );
    tasks.push(task);
  }

  logger.info(
    { jobs: schedulerDefinitions.map((definition) => ({ name: definition.name, cron: definition.expression })) },
    'deadline/reputation scheduler started',
  );
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  running = new Set<string>();
  logger.info('scheduler stopped');
}

/** Used by tests and the admin endpoint to run a job definition on demand. */
export async function runJobNow(name: string): Promise<unknown> {
  const definition = schedulerDefinitions.find((entry) => entry.name === name);
  if (!definition) throw new Error(`Unknown job: ${name}`);
  return definition.run();
}
