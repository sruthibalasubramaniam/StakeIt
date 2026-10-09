import type { NotificationType, Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { resolvePagination, paginated } from '../utils/http';
import { logger } from '../lib/logger';

type Tx = PrismaTransactionClient;

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * In-app notifications. Delivery is intentionally decoupled: `NotificationService`
 * only persists rows, so an email/push transport can be layered on later
 * without touching the business services that emit events.
 */
export const NotificationService = {
  async notify(tx: Tx | null, input: NotifyInput) {
    const client = tx ?? prisma;
    return client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
        metadata: input.metadata,
      },
    });
  },

  /**
   * Fire-and-forget variant used from services that must not fail because the
   * notification insert failed (e.g. inside a long settlement transaction the
   * caller already commits — we surface the error to the log instead).
   */
  async notifySafely(input: NotifyInput): Promise<void> {
    try {
      await this.notify(null, input);
    } catch (error) {
      logger.warn({ err: error, userId: input.userId, type: input.type }, 'Failed to persist notification');
    }
  },

  async notifyMany(inputs: NotifyInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
        metadata: input.metadata,
      })),
    });
    return result.count;
  },

  async list(userId: string, query: { page?: unknown; pageSize?: unknown; unreadOnly?: unknown }) {
    const pagination = resolvePagination(query as Record<string, unknown>);
    const where: Prisma.NotificationWhereInput = { userId };
    if (query.unreadOnly === 'true' || query.unreadOnly === true) where.isRead = false;

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return { ...paginated(items, total, pagination), unreadCount };
  },

  async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  },

  async markRead(userId: string, notificationId: string) {
    const notification = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) throw notFound('Notification');
    if (notification.isRead) return notification;

    return prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  },

  async markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count;
  },

  /** Idempotent guard so scheduled jobs don't spam the same reminder. */
  async alreadySent(userId: string, type: NotificationType, referenceId: string): Promise<boolean> {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type,
        metadata: { path: ['referenceId'], equals: referenceId },
      },
      select: { id: true },
    });
    return Boolean(existing);
  },
};
