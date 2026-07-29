import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Link } from 'react-router-dom';
import type { Notification } from '../../../server/db/notificationsRepo.js';
import {
  getUnackedCount, listNotifications, ackNotification, ackAllNotifications,
} from '../../lib/adminApi';
import { useAdminNotifications } from '../../lib/useAdminNotifications';
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
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [open]);

  return (
    <div className="notification-bell" ref={containerRef} data-testid="notification-bell">
      <button
        type="button"
        className="notification-bell__button"
        data-testid="notification-bell-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={togglePanel}
      >
        <span>Notifications</span>
        {unackedCount > 0 && (
          <span className="notification-bell__badge" data-testid="notification-bell-badge">
            {unackedCount > 99 ? '99+' : unackedCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell__panel" role="menu" data-testid="notification-bell-panel">
          <div className="notification-bell__panel-header">
            <h3 className="notification-bell__panel-title">Notifications</h3>
            <button
              type="button"
              data-testid="notification-mark-all-read"
              disabled={markingAll || unackedCount === 0}
              onClick={handleMarkAllRead}
            >
              Mark all read
            </button>
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
