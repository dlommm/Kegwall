import {
  useCallback, useEffect, useRef, useState,
} from 'react';

export type BannerKind = 'info' | 'warning' | 'success';

export interface Banner {
  id: string;
  text: string;
  kind: BannerKind;
  /** Phase 5 Task 4: a per-banner hold-duration override (e.g. a server wall_banner
   * action's `durationMs`) -- when absent, the hook-level default (`holdMs`, the
   * `useBanners(holdMs)` argument) applies instead. Not part of `push`'s public surface
   * on earlier callers (still fully optional/backward compatible). */
  holdMs?: number;
}

const DEFAULT_HOLD_MS = 8_000;

let bannerSeq = 0;
function nextBannerId(): string {
  bannerSeq += 1;
  return `banner-${bannerSeq}`;
}

export interface UseBannersResult {
  /** The pending queue, front-to-back. `BannerLane` only ever displays `queue[0]`. */
  queue: Banner[];
  push: (text: string, kind?: BannerKind, holdMsOverride?: number) => void;
  dismiss: (id: string) => void;
}

/**
 * A local FIFO banner queue for the wall's `BannerLane` (Task 5 plan): `push` enqueues a
 * banner, `queue[0]` is whichever is currently showing, and it's dismissed — either
 * automatically after `holdMs` (default 8s) or manually via `dismiss` — which reveals
 * the next queued banner. Phase 5 automations will eventually push banners over the WS
 * feed; Phase 3 only wires this local store plus a manual dev hook (see WallPage's
 * `window.__wall.banner`).
 */
export function useBanners(holdMs: number = DEFAULT_HOLD_MS): UseBannersResult {
  const [queue, setQueue] = useState<Banner[]>([]);
  // "Latest queue" ref (same pattern as useTapStates.ts's onMessageRef) so the
  // frontId-keyed dismiss-timer effect below can look up the front banner's OWN
  // `holdMs` override without needing `queue` in its dep array (which would restart the
  // hold countdown every time a banner joins behind the current one).
  const queueRef = useRef<Banner[]>(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const dismiss = useCallback((id: string) => {
    setQueue((q) => q.filter((b) => b.id !== id));
  }, []);

  const push = useCallback((text: string, kind: BannerKind = 'info', holdMsOverride?: number) => {
    setQueue((q) => [...q, { id: nextBannerId(), text, kind, holdMs: holdMsOverride }]);
  }, []);

  const frontId = queue[0]?.id;
  useEffect(() => {
    if (!frontId) return undefined;
    // Phase 5 Task 4: a server wall_banner action's durationMs (carried here as the front
    // banner's own `holdMs`) wins over the hook-level default when present.
    const effectiveHoldMs = queueRef.current.find((b) => b.id === frontId)?.holdMs ?? holdMs;
    const id = setTimeout(() => dismiss(frontId), effectiveHoldMs);
    return () => clearTimeout(id);
    // Deliberately keyed on `frontId`, not the whole `queue` array: a banner joining the
    // queue behind the currently-shown one must not restart its hold countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontId, holdMs]);

  return { queue, push, dismiss };
}
