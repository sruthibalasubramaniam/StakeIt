import { useState } from 'react';
import { notificationApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { SectionHeader } from '../../components/ui/data';
import { NotificationsPanel } from '../../components/domain/NotificationsPanel';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';

/** Notification centre with unread filtering and read marking. */
export function NotificationsPage() {
  useDocumentTitle('Notifications');
  const toast = useToast();

  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const notifications = useAsync(
    () => notificationApi.list({ pageSize: 50, unreadOnly: filter === 'unread' ? 'true' : undefined }),
    [filter],
  );

  const markRead = async (id: string) => {
    setMarkingId(id);
    try {
      await notificationApi.markRead(id);
      await notifications.refetch();
    } catch (caught) {
      toast.error('Could not mark as read', errorMessage(caught));
    } finally {
      setMarkingId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const result = await notificationApi.markAllRead();
      toast.success('All caught up', `${result.updated} notification(s) marked as read.`);
      await notifications.refetch();
    } catch (caught) {
      toast.error('Could not mark all as read', errorMessage(caught));
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        title="Notifications"
        meta={
          <span className="flex items-baseline gap-1.5">
            <span className="micro-label text-on-surface-variant">Unread:</span>
            <span className="font-mono text-label-md tabular text-on-surface">{notifications.data?.unreadCount ?? 0}</span>
          </span>
        }
      />

      <NotificationsPanel
        notifications={notifications.data?.items ?? []}
        unreadCount={notifications.data?.unreadCount ?? 0}
        loading={notifications.loading}
        error={notifications.error}
        filter={filter}
        onFilterChange={setFilter}
        onMarkRead={(id) => void markRead(id)}
        onMarkAllRead={() => void markAllRead()}
        onRetry={() => void notifications.refetch()}
        markingId={markingId}
        markingAll={markingAll}
      />

      <p className="font-label-xs text-label-xs text-on-surface-variant">
        Deadline reminders, at-risk warnings, reward credits and forfeiture notices are all delivered here. Email delivery can be
        layered on the same event feed.
      </p>
    </div>
  );
}
