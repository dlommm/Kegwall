import { useEffect, useRef, useState } from 'react';
import type { TapState } from '../../server/core/state.js';

const STALE_TIMEOUT_MS = 60_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface UseTapStatesOptions {
  /**
   * Overrides the computed `/ws` URL. Production never sets this (the hook derives the
   * URL from `window.location`); tests use it to point at a fake/real ws server directly.
   */
  url?: string;
  /**
   * Phase 5 Task 4: invoked for EVERY successfully-parsed message this socket receives
   * (snapshot/ping included, not just new message kinds) -- a generic escape hatch rather
   * than a typed field per message kind, so consumers (WallPage's banner queue / party
   * mode, a future admin bell-badge) can subscribe to whatever `type`s they care about
   * without this hook needing to know about them. Kept in a ref internally (see the
   * connect effect's dep list) so a new function identity across renders never tears
   * down/reopens the socket -- only `url` does that.
   */
  onMessage?: (msg: unknown) => void;
}

export interface UseTapStatesResult {
  taps: TapState[];
  /** True once 60s have passed without receiving any message (timer resets per message). */
  stale: boolean;
  connected: boolean;
  /**
   * Increments each time the socket successfully (re)opens after a prior successful open —
   * i.e. it stays 0 for the initial connection and only counts genuine reconnects. Consumers
   * (e.g. useWallData) use this to know when to re-fetch things a snapshot doesn't carry.
   */
  reconnectCount: number;
}

interface SnapshotMessage {
  type: 'snapshot';
  taps: TapState[];
}

function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'snapshot'
    && Array.isArray((value as { taps?: unknown }).taps)
  );
}

function defaultWsUrl(): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws`;
}

/**
 * Subscribes to the public `/ws` snapshot feed. Applies `{type: 'snapshot', taps}` messages
 * as they arrive, auto-reconnects with exponential backoff (1s doubling, capped at 30s), and
 * flags `stale` once 60s pass without any message (the timer resets on every message, not
 * just snapshots that change data).
 */
export function useTapStates(
  initial: TapState[],
  options: UseTapStatesOptions = {},
): UseTapStatesResult {
  const { url, onMessage } = options;
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  // `liveTaps` starts null (no message received yet) and is set permanently once the
  // first snapshot arrives. Until then, the returned taps track the latest `initial`
  // argument — so a REST fetch that resolves after mount (e.g. useWallData's getWall)
  // but before the socket's first message still reaches the caller instead of being
  // silently dropped by a one-time useState(initial) seed.
  const [liveTaps, setLiveTaps] = useState<TapState[] | null>(null);
  const [stale, setStale] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoffMs = BACKOFF_MIN_MS;
    let hasOpenedBefore = false;

    const resetStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      setStale(false);
      staleTimer = setTimeout(() => {
        if (!cancelled) setStale(true);
      }, STALE_TIMEOUT_MS);
    };

    const connect = () => {
      if (cancelled) return;
      const wsUrl = url ?? defaultWsUrl();
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        backoffMs = BACKOFF_MIN_MS;
        if (hasOpenedBefore) {
          setReconnectCount((n) => n + 1);
        }
        hasOpenedBefore = true;
      };

      socket.onmessage = (event: MessageEvent) => {
        if (cancelled) return;
        resetStaleTimer();
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (isSnapshotMessage(parsed)) {
          setLiveTaps(parsed.taps);
        }
        onMessageRef.current?.(parsed);
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

    resetStaleTimer();
    connect();

    return () => {
      cancelled = true;
      if (staleTimer) clearTimeout(staleTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
    // `initial` intentionally excluded: it's read directly in the return statement below
    // (not by this effect), so a new array reference must never tear down and reopen the
    // socket. `url` is the only thing that should ever restart the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return {
    taps: liveTaps ?? initial, stale, connected, reconnectCount,
  };
}
