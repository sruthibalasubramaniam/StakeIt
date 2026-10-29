/**
 * Email delivery for notifications.
 *
 * One rule keeps this small: **email is a transport for the notification that
 * already exists.** No new copy is invented here — each mail reuses the title,
 * message and link the in-app notification carries, which is why there is no
 * second set of business strings to drift out of sync.
 *
 * Guarantees:
 *  - idempotent per notification (`email_deliveries.notification_id` is unique);
 *  - never throws into a caller's request path — failures are recorded and logged;
 *  - receipts (enrolment, completion, settlement) ignore the marketing opt-out,
 *    optional nudges respect it;
 *  - a rolled-back transaction produces no email, because the dispatcher is
 *    scheduled outside the transaction and re-reads the notification.
 */
import type { NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { isEmailConfigured, sendEmail } from '../lib/mailer';

/** Types a learner may switch off. Everything else is a receipt for their own action. */
export const OPTIONAL_EMAIL_TYPES: NotificationType[] = [
  'DEADLINE_APPROACHING',
  'AT_RISK',
  'ACCELERATED_DEADLINE',
  'RETRY_AVAILABLE',
  'SYSTEM',
];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Minimal, table-free layout that survives Outlook and dark mode without a
 * build step. Inline styles only — mail clients strip <style> unpredictably.
 */
export function renderEmail(input: { title: string; message: string; link?: string | null; name?: string | null }) {
  const name = input.name ? `Hi ${escapeHtml(input.name.split(' ')[0]!)},` : 'Hello,';
  const cta = input.link
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(`${env.APP_URL}${input.link}`)}"
         style="background:#4527A0;color:#ffffff;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:600">Open Stake It</a></p>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d21">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dddfe3;border-radius:6px;padding:28px">
    <p style="margin:0 0 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5a6169">Stake It</p>
    <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35">${escapeHtml(input.title)}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#1a1d21">${name}</p>
    <p style="margin:8px 0 0;font-size:15px;line-height:1.6;color:#1a1d21">${escapeHtml(input.message)}</p>
    ${cta}
    <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#8a8f98">
      You are receiving this because you have a Stake It account. Reminder emails can be
      switched off in your profile; receipts for your own enrolments and settlements cannot.
    </p>
  </div>
</body></html>`;

  const text = [
    input.title,
    '',
    name,
    input.message,
    input.link ? `\nOpen: ${env.APP_URL}${input.link}` : '',
    '',
    'You are receiving this because you have a Stake It account.',
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

export interface DispatchResult {
  status: 'SENT' | 'SKIPPED' | 'FAILED' | 'DUPLICATE';
  reason?: string;
  providerId?: string | null;
}

export const EmailService = {
  isConfigured: isEmailConfigured,

  /**
   * Sends the email for one notification, if it should be sent at all.
   *
   * Safe to call twice, safe to call for a notification that no longer exists
   * (rolled-back transaction), and safe to call when email is unconfigured.
   */
  async dispatchNotification(notificationId: string): Promise<DispatchResult> {
    if (!isEmailConfigured()) return { status: 'SKIPPED', reason: 'email_not_configured' };

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, isActive: true, emailNotificationsEnabled: true },
        },
      },
    });
    if (!notification) return { status: 'SKIPPED', reason: 'notification_missing' };
    if (!notification.user?.isActive) return { status: 'SKIPPED', reason: 'user_inactive' };

    const isOptional = OPTIONAL_EMAIL_TYPES.includes(notification.type);
    if (isOptional && !notification.user.emailNotificationsEnabled) {
      // Not recorded: the learner may enable reminders later, and this one is past anyway.
      return { status: 'SKIPPED', reason: 'opted_out' };
    }

    const existing = await prisma.emailDelivery.findUnique({ where: { notificationId } });
    if (existing) return { status: 'DUPLICATE', reason: existing.status };

    const { html, text } = renderEmail({
      title: notification.title,
      message: notification.message,
      link: notification.link,
      name: notification.user.fullName,
    });

    try {
      const sent = await sendEmail({
        to: notification.user.email,
        subject: notification.title,
        html,
        text,
        idempotencyKey: `notification-${notification.id}`,
      });

      await prisma.emailDelivery.create({
        data: {
          notificationId: notification.id,
          userId: notification.userId,
          type: notification.type,
          toEmail: notification.user.email,
          subject: notification.title,
          status: 'SENT',
          providerId: sent.providerId,
        },
      });

      return { status: 'SENT', providerId: sent.providerId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email failure';
      logger.warn({ err: error, notificationId, type: notification.type }, 'Email delivery failed');

      /*
       * Record the failure so the same notification is not retried forever, but
       * swallow a unique-constraint race: two dispatchers may run for one
       * notification and the second must not crash.
       */
      await prisma.emailDelivery
        .create({
          data: {
            notificationId: notification.id,
            userId: notification.userId,
            type: notification.type,
            toEmail: notification.user.email,
            subject: notification.title,
            status: 'FAILED',
            error: message.slice(0, 300),
          },
        })
        .catch(() => undefined);

      return { status: 'FAILED', reason: message };
    }
  },

  /** Recent deliveries for one user — support/debugging surface, admin-only. */
  async recentForUser(userId: string, limit = 20) {
    return prisma.emailDelivery.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: { id: true, type: true, subject: true, status: true, error: true, createdAt: true },
    });
  },
};
