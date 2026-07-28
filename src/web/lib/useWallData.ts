import { useEffect, useState } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { getWall } from './api';
import { useTapStates } from './useTapStates';

export interface UseWallDataResult {
  wall: { slug: string; name: string; config: WallConfig } | null;
  taps: TapState[];
  stale: boolean;
  connected: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a wall's config + initial tap snapshot via `getWall`, then hands live updates off
 * to `useTapStates`. Config doesn't ride the WS snapshot (only taps do), so we re-fetch it
 * whenever the socket reconnects — a cheap way to pick up wall edits made while disconnected.
 */
export function useWallData(slug: string | undefined): UseWallDataResult {
  const [wall, setWall] = useState<UseWallDataResult['wall']>(null);
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setWall(null);
      setInitialTaps([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getWall(slug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setWall(result.data.wall);
        setInitialTaps(result.data.taps);
        setError(null);
      } else {
        setError(result.message);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const {
    taps, stale, connected, reconnectCount,
  } = useTapStates(initialTaps);

  useEffect(() => {
    // reconnectCount is 0 on the initial mount (useTapStates only increments it after a
    // prior successful open), so this only fires on genuine reconnects, never on mount.
    if (!slug || reconnectCount === 0) return;

    let cancelled = false;
    getWall(slug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setWall(result.data.wall);
        setError(null);
      } else {
        setError(result.message);
      }
    });

    return () => {
      cancelled = true;
    };
    // `slug` intentionally omitted from deps: a slug change is already handled by the
    // effect above, which fetches immediately — re-running this one too would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectCount]);

  return {
    wall, taps, stale, connected, loading, error,
  };
}
