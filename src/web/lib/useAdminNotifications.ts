import { useEffect, useRef } from 'react';
import { useReconnectingSocket } from './useReconnectingSocket';

export interface UseAdminNotificationsOptions {
  /** Overrides the computed `/ws` URL — production never sets this; tests point at a
   * fake/real ws server directly (see `useTapStates.ts`'s identical option). */
  url?: string;
}

export interface UseAdminNotificationsResult {
  connected: boolean;
}

interface NotificationsMessage { type: 'notifications'; unackedCount: number }

function isNotificationsMessage(value: unknown): value is NotificationsMessage {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'notifications'
    && typeof (value as { unackedCount?: unknown }).unackedCount === 'number'
  );
}

/**
 * A light, admin-only `/ws` subscription dedicated to the notification bell's live
 * unacked-count badge (Task 6). Admin has no existing ALWAYS-mounted socket to piggyback
 * on: `useTapStates` is opened per-page (only TapsPage/DashboardPage/MonitorsPage call
 * it) — a rule firing while an admin is on, say, the Beers or Settings page would never
 * reach the badge if this reused one of those page-scoped connections. `AdminLayout` (the
 * one component mounted for the ENTIRE `/admin/*` session, wrapping every page via
 * `<Outlet>`) is therefore the right place to open a SECOND, admin-scoped socket — this
 * hook — rather than threading a generic-message callback through five-plus otherwise
 * unrelated pages just so one of them can happen to stay connected. Justified per the
 * plan's own "acceptable second socket for admin surface" framing.
 *
 * Deliberately much lighter than `useTapStates`: no snapshot state, no `stale` flag, no
 * `initial` seed to reconcile against a late-resolving REST fetch — just "reconnect with
 * exponential backoff, and call `onCount` whenever a `{type:'notifications'}` message
 * arrives" (see `routes/ws.ts`'s `state_changed{scope:'notifications'}` relay). The
 * caller (AdminLayout/NotificationBell) owns the actual count state — this hook is a pure
 * transport, matching `useTapStates`' own `onMessage` escape hatch's spirit but as the
 * hook's ENTIRE purpose rather than an add-on. Both hooks now ride the same
 * `useReconnectingSocket` connect/backoff/teardown core.
 */
export function useAdminNotifications(
  onCount: (count: number) => void,
  options: UseAdminNotificationsOptions = {},
): UseAdminNotificationsResult {
  const { url } = options;
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  }, [onCount]);

  const { connected } = useReconnectingSocket({
    url,
    onParsedMessage: (parsed) => {
      if (isNotificationsMessage(parsed)) onCountRef.current(parsed.unackedCount);
    },
  });

  return { connected };
}
