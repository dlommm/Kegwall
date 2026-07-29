import { useEffect, useRef, useState } from 'react';

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

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

function defaultWsUrl(): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws`;
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
 * hook's ENTIRE purpose rather than an add-on.
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

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoffMs = BACKOFF_MIN_MS;

    const connect = () => {
      if (cancelled) return;
      const wsUrl = url ?? defaultWsUrl();
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        backoffMs = BACKOFF_MIN_MS;
      };

      socket.onmessage = (event: MessageEvent) => {
        if (cancelled) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (isNotificationsMessage(parsed)) onCountRef.current(parsed.unackedCount);
      };

      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, backoffMs);
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      };

      socket.onerror = () => {
        // Same defensive nudge as useTapStates.ts — a WebSocket that errors always
        // transitions to closed right after; onclose above owns reconnect scheduling.
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
    // `onCount` intentionally excluded — read via `onCountRef` so a new callback identity
    // across renders never tears down/reopens the socket. Only `url` should do that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { connected };
}
