import type { Notification } from '../../../server/db/notificationsRepo.js';
import { useRelativeTime } from '../../lib/useRelativeTime';

export interface NotificationRowProps {
  notification: Notification;
  onAck: (id: number) => void;
  acking: boolean;
}

/**
 * One notification's row (Task 6) — severity dot, title/body, relative time, and (only
 * while unacked) an "Ack" button. Shared by `NotificationBell`'s dropdown panel and the
 * full `/admin/notifications` page, so severity/relative-time formatting only lives in
 * one place. A plain colored dot (not an emoji) marks severity, matching the rest of the
 * admin UI's existing badge language (e.g. `.users-role-badge`).
 */
export function NotificationRow({ notification, onAck, acking }: NotificationRowProps) {
  const relative = useRelativeTime(notification.ts);

  return (
    <li className="notification-row" data-testid="notification-row" data-acked={notification.acked}>
      <span
        className={`notification-row__severity notification-row__severity--${notification.severity}`}
        data-testid="notification-row-severity"
        title={notification.severity}
        aria-hidden="true"
      />
      <div className="notification-row__body">
        <p className="notification-row__title">{notification.title}</p>
        {notification.body && <p className="notification-row__detail">{notification.body}</p>}
        <span className="notification-row__time" data-testid="notification-row-time">{relative}</span>
      </div>
      {!notification.acked && (
        <button
          type="button"
          className="notification-row__ack"
          data-testid={`notification-row-ack-${notification.id}`}
          disabled={acking}
          onClick={() => onAck(notification.id)}
        >
          {acking ? 'Acking…' : 'Ack'}
        </button>
      )}
    </li>
  );
}
