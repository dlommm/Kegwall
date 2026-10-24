import { useCallback, useEffect, useState } from 'react';
import type { Notification } from '../../../server/db/notificationsRepo.js';
import {
  listNotifications, ackNotification, ackAllNotifications,
} from '../../lib/adminApi';
import { NotificationRow } from './NotificationRow';
import { PageTemplate } from './PageTemplate';
import { capitalize, countWord } from '../../lib/tonightAttention';
import {
  Button, EmptyState, ErrorState, Skeleton,
} from './ui';

const PAGE_SIZE = 25;

type PageStatus = 'loading' | 'loaded' | 'error';

/**
 * `/admin/notifications` (Task 6) — the full notification history with before-cursor
 * pagination (see `db/notificationsRepo.ts`'s `listNotifications`: `before` is an
 * EXCLUSIVE cursor on `id`, not `ts`). No role branching: every role that can reach this
 * page can also ack from it, same as `NotificationBell`'s panel. The plan's own Task 6
 * text says "Viewer read-only throughout" — this is a DELIBERATE implementation judgment
 * call that deviates from that (see `routes/notifications.ts`'s matching doc comment and
 * the Task 6 report's Design Calls section), not a plan requirement: acking is a shared,
 * app-wide bit (no per-user "read" state), not a personal preference or a managed-resource
 * mutation, so gating it above `viewer` buys no real access control.
 */
export function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const loadFirstPage = useCallback(() => {
    setStatus('loading');
    listNotifications({ limit: PAGE_SIZE }).then((result) => {
      if (result.ok) {
        setItems(result.data);
        setHasMore(result.data.length === PAGE_SIZE);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  async function handleLoadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const result = await listNotifications({ limit: PAGE_SIZE, before: last.id });
    setLoadingMore(false);
    if (result.ok) {
      setItems((cur) => [...cur, ...result.data]);
      setHasMore(result.data.length === PAGE_SIZE);
    }
  }

  async function handleAck(id: number) {
    setAckingId(id);
    const result = await ackNotification(id);
    setAckingId(null);
    if (result.ok) {
      setItems((cur) => cur.map((n) => (n.id === id ? result.data : n)));
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    const result = await ackAllNotifications();
    setMarkingAll(false);
    if (result.ok) {
      setItems((cur) => cur.map((n) => ({ ...n, acked: true })));
    }
  }

  const anyUnacked = items.some((n) => !n.acked);

  const unread = items.filter((n) => !n.acked).length;

  return (
    <PageTemplate
      testId="admin-notifications-page"
      title={status !== 'loaded' ? 'Notifications'
        : unread === 0 ? 'You’re all caught up.'
          : `${unread === 1 ? 'One notification' : `${capitalize(countWord(unread))} notifications`} to read.`}
      sub="Alerts from your automations and from Kegwall itself, newest first. The bell in the top bar shows the latest."
      actions={(anyUnacked || markingAll) && (
        <Button
          data-testid="notifications-page-mark-all-read"
          disabled={markingAll || !anyUnacked}
          onClick={handleMarkAllRead}
        >
          Mark all read
        </Button>
      )}
    >
      {status === 'loading' && <div data-testid="notifications-page-loading"><Skeleton height={80} /></div>}
      {status === 'error' && (
        <div data-testid="notifications-page-error">
          <ErrorState title="Couldn’t load notifications.">Reload to try again.</ErrorState>
        </div>
      )}
      {status === 'loaded' && items.length === 0 && (
        <div data-testid="notifications-page-empty"><EmptyState title="No notifications yet." /></div>
      )}

      {status === 'loaded' && items.length > 0 && (
        <>
          <ul className="notifications-page__list" data-testid="notifications-page-list">
            {items.map((n) => (
              <NotificationRow key={n.id} notification={n} onAck={handleAck} acking={ackingId === n.id} />
            ))}
          </ul>

          {hasMore && (
            <Button
              data-testid="notifications-page-load-more"
              disabled={loadingMore}
              onClick={handleLoadMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </PageTemplate>
  );
}
