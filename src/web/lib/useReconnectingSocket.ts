import { useEffect, useRef, useState } from 'react';

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** The app's `/ws` endpoint on the current origin (ws/wss to match http/https). */
export function defaultWsUrl(): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws`;
}

export interface UseReconnectingSocketOptions {
  /**
   * Overrides the computed `/ws` URL. Production never sets this (the hook derives the
   * URL from `window.location`); tests use it to point at a fake/real ws server directly.
   */
  url?: string;
  /**
   * Applied to the resolved URL immediately before EACH connection attempt (initial and
   * every reconnect) — e.g. `withDisplayTokenQuery` appending the display auth token, so
   * a token that appears/changes between attempts is picked up.
   */
  decorateUrl?: (url: string) => string;
  /** Fired for every frame received, BEFORE JSON parsing (unparseable frames included). */
  onAnyMessage?: () => void;
  /** Fired for every successfully-JSON-parsed frame. Unparseable frames are dropped. */
  onParsedMessage?: (msg: unknown) => void;
  /** Fired on every successful open; `isReconnect` is false only for the first open. */
  onOpen?: (info: { isReconnect: boolean }) => void;
}

export interface UseReconnectingSocketResult {
  connected: boolean;
}

/**
 * The shared reconnecting-WebSocket transport `useTapStates` and
 * `useAdminNotifications` used to each hand-roll: connect, parse frames,
 * auto-reconnect with exponential backoff (1s doubling, capped at 30s, reset on a
 * successful open), and tear everything down — handlers detached, socket closed,
 * timers cleared — on unmount.
 *
 * All callbacks are read through refs, so a new function identity across renders
 * never tears down/reopens the socket — only a `url` change restarts the connection
 * (the exact contract both original hooks documented).
 */
export function useReconnectingSocket(
  options: UseReconnectingSocketOptions = {},
): UseReconnectingSocketResult {
  const { url } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoffMs = BACKOFF_MIN_MS;
    let hasOpenedBefore = false;

    const connect = () => {
      if (cancelled) return;
      const opts = optionsRef.current;
      const baseUrl = opts.url ?? defaultWsUrl();
      const wsUrl = opts.decorateUrl ? opts.decorateUrl(baseUrl) : baseUrl;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        backoffMs = BACKOFF_MIN_MS;
        const isReconnect = hasOpenedBefore;
        hasOpenedBefore = true;
        optionsRef.current.onOpen?.({ isReconnect });
      };

      socket.onmessage = (event: MessageEvent) => {
        if (cancelled) return;
        optionsRef.current.onAnyMessage?.();
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          return;
        }
        optionsRef.current.onParsedMessage?.(parsed);
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
        // A WebSocket that errors always transitions to closed right after — onclose
        // (above) owns reconnect scheduling, so this just nudges it along defensively.
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
    // Callbacks are read via `optionsRef` so a new identity across renders never tears
    // down/reopens the socket. Only `url` should restart the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { connected };
}
