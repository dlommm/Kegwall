import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Link } from 'react-router';
import type { Notification } from '../../../server/db/notificationsRepo.js';
import {
  getUnackedCount, listNotifications, ackNotification, ackAllNotifications,
} from '../../lib/adminApi';
import { useAdminNotifications } from '../../lib/useAdminNotifications';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { NotificationRow } from './NotificationRow';

const RECENT_LIMIT = 10;

type PanelStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * The notification center's entry point (Task 6): a bell button in `AdminLayout`'s
 * header with a live unacked-count badge, and a dropdown panel listing the 10 most
 * recent notifications with per-item ack + "Mark all read". Mounted once by AdminLayout
 * (not per-page), so its `useAdminNotifications` socket and initial `getUnackedCount()`
 * fetch each happen exactly once per admin session, same discipline as
 * `AdminLayout`'s own `getMe()`/`getMenu()` calls.
 */
export function NotificationBell() {
  const [unackedCount, setUnackedCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUnackedCount().then((result) => {
      if (!cancelled && result.ok) setUnackedCount(result.data.count);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The live WS nudge (see useAdminNotifications.ts's doc comment for why this is its
  // own dedicated admin-scoped socket rather than reusing a page-level one).
  useAdminNotifications(setUnackedCount);

  const loadRecent = useCallback(() => {
    setStatus('loading');
    listNotifications({ limit: RECENT_LIMIT }).then((result) => {
      if (result.ok) {
        setItems(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, []);

  function togglePanel() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) loadRecent();
      return next;
    });
  }

  async function handleAck(id: number) {
    setAckingId(id);
    const result = await ackNotification(id);
    setAckingId(null);
    if (result.ok) {
      setItems((cur) => cur.map((n) => (n.id === id ? result.data : n)));
      setUnackedCount((c) => Math.max(0, c - 1));
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    const result = await ackAllNotifications();
    setMarkingAll(false);
    if (result.ok) {
      setItems((cur) => cur.map((n) => ({ ...n, acked: true })));
      setUnackedCount(0);
    }
  }

  // Closes the panel on any click outside it — a dropdown that only closes via its own
  // bell toggle would otherwise stay open while an admin clicks around the rest of the
  // page.
  useEffect(() => {
    if (!open) return undefined;
    function handleDocumentClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Escape closes it too, and gives focus back to the bell.
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      containerRef.current?.querySelector<HTMLButtonElement>('.notification-bell__button')?.focus();
    }
    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="notification-bell" ref={containerRef} data-testid="notification-bell">
      <button
        type="button"
        className="notification-bell__button"
        data-testid="notification-bell-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={togglePanel}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
          <path d="M10 20a2.2 2.2 0 0 0 4 0" />
        </svg>
        <span className="adm-sr-only">Notifications</span>
        {unackedCount > 0 && (
          <span className="notification-bell__badge" data-testid="notification-bell-badge">
            {unackedCount > 99 ? '99+' : unackedCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell__panel" role="dialog" aria-label="Notifications" data-testid="notification-bell-panel">
          <div className="notification-bell__panel-header">
            <h3 className="notification-bell__panel-title" data-testid="notification-panel-title">
              {status !== 'loaded' ? 'Notifications'
                : unackedCount === 0 ? 'All caught up.'
                  : unackedCount === 1 ? 'One needs you.' : `${capitalize(countWord(unackedCount))} need you.`}
            </h3>
            {unackedCount > 0 && (
              <button
                type="button"
                data-testid="notification-mark-all-read"
                disabled={markingAll}
                onClick={handleMarkAllRead}
              >
                Mark all read
              </button>
            )}
          </div>

          {status === 'loading' && (
            <p className="admin-page-quiet" data-testid="notification-panel-loading">Loading…</p>
          )}
          {status === 'error' && (
            <p className="admin-page-quiet" role="alert" data-testid="notification-panel-error">
              Couldn&rsquo;t load notifications.
            </p>
          )}
          {status === 'loaded' && items.length === 0 && (
            <p className="admin-page-quiet" data-testid="notification-panel-empty">No notifications yet.</p>
          )}
          {status === 'loaded' && items.length > 0 && (
            <ul className="notification-bell__list" data-testid="notification-bell-list">
              {items.map((n) => (
                <NotificationRow key={n.id} notification={n} onAck={handleAck} acking={ackingId === n.id} />
              ))}
            </ul>
          )}

          <Link
            to="/admin/notifications"
            className="notification-bell__view-all"
            data-testid="notification-panel-view-all"
            onClick={() => setOpen(false)}
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
