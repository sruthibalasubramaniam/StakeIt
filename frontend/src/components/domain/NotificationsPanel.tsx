import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Button, Chip, MaterialIcon } from '../ui/core';
import { EmptyState, ErrorBlock, LoadingBlock, Tabs } from '../ui/data';
import { formatRelative } from '../../utils/format';
import type { NotificationRow } from '../../types/api';

/** Icon + tone per notification type, matching the platform's event vocabulary. */
const NOTIFICATION_STYLES: Record<string, { icon: string; className: string }> = {
  ENROLLMENT: { icon: 'school', className: 'text-primary-container' },
  DEADLINE_APPROACHING: { icon: 'schedule', className: 'text-tertiary-container' },
  AT_RISK: { icon: 'warning', className: 'text-error' },
  ACCELERATED_DEADLINE: { icon: 'timer', className: 'text-primary-container' },
  COURSE_COMPLETED: { icon: 'check_circle', className: 'text-secondary' },
  REWARD_RECEIVED: { icon: 'savings', className: 'text-secondary' },
  STAKE_FORFEITED: { icon: 'gavel', className: 'text-error' },
  RETRY_AVAILABLE: { icon: 'restart_alt', className: 'text-primary-container' },
  INSTRUCTOR_BADGE: { icon: 'military_tech', className: 'text-secondary' },
  SYSTEM: { icon: 'info', className: 'text-on-surface-variant' },
};

export function NotificationRowItem({
  notification,
  onMarkRead,
  marking = false,
}: {
  notification: NotificationRow;
  onMarkRead?: (id: string) => void;
  marking?: boolean;
}) {
  const style = NOTIFICATION_STYLES[notification.type] ?? NOTIFICATION_STYLES.SYSTEM!;

  return (
    <li
      className={cn(
        'flex items-start gap-space-md px-space-lg py-space-md transition-colors',
        notification.isRead ? 'bg-surface-container-lowest' : 'bg-primary-fixed/25',
      )}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-container-lowest">
        <MaterialIcon name={style.icon} className={cn('text-[16px]', style.className)} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-space-sm">
          <span className="font-label-md text-label-md text-on-surface">{notification.title}</span>
          {!notification.isRead ? <span className="h-1.5 w-1.5 rounded-full bg-primary-container" aria-label="Unread" /> : null}
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">{notification.message}</p>
        <div className="mt-0.5 flex items-center gap-space-md">
          <span className="font-label-xs text-label-xs text-on-surface-variant">{formatRelative(notification.createdAt)}</span>
          {notification.link ? (
            <Link to={notification.link} className="font-label-xs text-label-xs text-primary hover:underline">
              Open
            </Link>
          ) : null}
        </div>
      </div>

      {!notification.isRead && onMarkRead ? (
        <Button size="sm" variant="ghost" loading={marking} onClick={() => onMarkRead(notification.id)}>
          Mark read
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Notifications list with unread filtering. The page owns the data fetch so the
 * header badge and the page stay consistent.
 */
export function NotificationsPanel({
  notifications,
  unreadCount,
  loading,
  error,
  filter,
  onFilterChange,
  onMarkRead,
  onMarkAllRead,
  onRetry,
  markingId,
  markingAll,
}: {
  notifications: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  filter: 'all' | 'unread';
  onFilterChange: (filter: 'all' | 'unread') => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onRetry: () => void;
  markingId?: string | null;
  markingAll?: boolean;
}) {
  return (
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <Tabs
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread', count: unreadCount },
          ]}
          active={filter}
          onChange={(id) => onFilterChange(id as 'all' | 'unread')}
          className="border-b-0"
        />
        {unreadCount > 0 ? (
          <Button size="sm" variant="secondary" icon="done_all" loading={markingAll} onClick={onMarkAllRead}>
            Mark all read
          </Button>
        ) : (
          <Chip tone="earned" icon="check">
            all caught up
          </Chip>
        )}
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={onRetry} />
      ) : loading ? (
        <LoadingBlock label="Loading notifications…" rows={4} />
      ) : notifications.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon="notifications_off"
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={
              filter === 'unread'
                ? 'Everything has been read. Switch to All to review earlier activity.'
                : 'Deadline reminders, rewards and stake events will appear here.'
            }
          />
        </div>
      ) : (
        <ul className="surface-card divide-y divide-outline-variant overflow-hidden">
          {notifications.map((notification) => (
            <NotificationRowItem
              key={notification.id}
              notification={notification}
              onMarkRead={onMarkRead}
              marking={markingId === notification.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
