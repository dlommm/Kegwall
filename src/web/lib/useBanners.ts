import { useCallback, useEffect, useState } from 'react';

export type BannerKind = 'info' | 'warning' | 'success';

export interface Banner {
  id: string;
  text: string;
  kind: BannerKind;
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
  push: (text: string, kind?: BannerKind) => void;
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

  const dismiss = useCallback((id: string) => {
    setQueue((q) => q.filter((b) => b.id !== id));
  }, []);

  const push = useCallback((text: string, kind: BannerKind = 'info') => {
    setQueue((q) => [...q, { id: nextBannerId(), text, kind }]);
  }, []);

  const frontId = queue[0]?.id;
  useEffect(() => {
    if (!frontId) return undefined;
    const id = setTimeout(() => dismiss(frontId), holdMs);
    return () => clearTimeout(id);
    // Deliberately keyed on `frontId`, not the whole `queue` array: a banner joining the
    // queue behind the currently-shown one must not restart its hold countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontId, holdMs]);

  return { queue, push, dismiss };
}
