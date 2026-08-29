import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import type { TapState } from '../../server/core/state.js';
import { withDisplayTokenQuery } from './displayToken';
import { useReconnectingSocket } from './useReconnectingSocket';

const STALE_TIMEOUT_MS = 60_000;

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
   * without this hook needing to know about them. Kept in a ref internally (see
   * `useReconnectingSocket`'s contract) so a new function identity across renders never
   * tears down/reopens the socket -- only `url` does that.
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
  /** The server's app version (ws.ts stamps it) — drives the kiosk auto-reload. */
  version?: string;
}

function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'snapshot'
    && Array.isArray((value as { taps?: unknown }).taps)
  );
}

/**
 * Structural sharing across snapshots (wall-look memoization): the server pushes a FULL
 * snapshot for every state change, so most incoming tap objects are byte-identical to
 * the ones already held — but always as fresh references, which would defeat every
 * `React.memo`/`useMemo` downstream. Reuse the previous `TapState` reference whenever a
 * tap's payload is unchanged, and the previous ARRAY reference when every tap is — a
 * no-op snapshot then bails out of the React state update entirely, and a
 * one-tap-pouring snapshot re-renders only that tap's memoized card/row.
 *
 * Equality via JSON.stringify is safe here: both sides came off the same server
 * serializer (WS snapshot / REST seed), so key order is stable; a false negative would
 * only cost a skipped reuse, never a wrong render.
 */
export function stabilizeTaps(prev: TapState[] | null, next: TapState[]): TapState[] {
  if (!prev) return next;
  let reusedAll = prev.length === next.length;
  const byId = new Map(prev.map((t) => [t.tapId, t]));
  const merged = next.map((tap, i) => {
    const old = byId.get(tap.tapId);
    if (old && JSON.stringify(old) === JSON.stringify(tap)) {
      // Reused, but only positionally-identical reuse lets the whole ARRAY be reused —
      // a reordered snapshot must still produce a fresh array in the NEW order.
      if (old !== prev[i]) reusedAll = false;
      return old;
    }
    reusedAll = false;
    return tap;
  });
  return reusedAll ? prev : merged;
}

/**
 * Subscribes to the public `/ws` snapshot feed. Applies `{type: 'snapshot', taps}` messages
 * as they arrive, auto-reconnects with exponential backoff (1s doubling, capped at 30s —
 * see `useReconnectingSocket`, the shared transport), and flags `stale` once 60s pass
 * without any message (the timer resets on every message, not just snapshots that change
 * data).
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
  const [reconnectCount, setReconnectCount] = useState(0);
  // First server version seen this page-load — survives socket reconnects on purpose
  // (the reload must fire on version CHANGE, which only happens across reconnects).
  const serverVersionRef = useRef<string | null>(null);

  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resetStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    setStale(false);
    staleTimerRef.current = setTimeout(() => setStale(true), STALE_TIMEOUT_MS);
  }, []);
  // The stale clock starts at mount (before the first message) and restarts if the
  // socket target changes — matching the original single-effect lifecycle.
  useEffect(() => {
    resetStaleTimer();
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [resetStaleTimer, url]);

  const { connected } = useReconnectingSocket({
    url,
    // Attach the display token (query param — a WebSocket can't set headers) so the socket
    // authenticates when server-side enforcement is on. No-op for an unpaired client.
    decorateUrl: withDisplayTokenQuery,
    onAnyMessage: resetStaleTimer,
    onParsedMessage: (parsed) => {
      if (isSnapshotMessage(parsed)) {
        setLiveTaps((prev) => stabilizeTaps(prev, parsed.taps));
        // Kiosk auto-reload: a wall TV's browser never reloads on its own, so an
        // app update would leave it running the pre-update JS bundle forever
        // (missing every client-side feature/fix from then on). The server stamps
        // its version into each snapshot; when it CHANGES mid-session (server
        // restarted on a new release), reload once to pick up the new bundle.
        // First-seen version is the baseline — never reloads on initial connect.
        if (parsed.version) {
          if (serverVersionRef.current && parsed.version !== serverVersionRef.current) {
            window.location.reload();
            return;
          }
          serverVersionRef.current = parsed.version;
        }
      }
      onMessageRef.current?.(parsed);
    },
    onOpen: ({ isReconnect }) => {
      if (isReconnect) setReconnectCount((n) => n + 1);
    },
  });

  return {
    taps: liveTaps ?? initial, stale, connected, reconnectCount,
  };
}
