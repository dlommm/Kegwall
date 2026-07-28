import { useEffect, useState } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { getWall } from './api';
import { useTapStates } from './useTapStates';
import type { VolumeUnits } from './units';

export interface UseWallDataResult {
  wall: { slug: string; name: string; config: WallConfig } | null;
  taps: TapState[];
  /** The taproom's configured display units. Defaults to `'us'` until the first
   * successful `getWall` response resolves (matches the server's own default). */
  units: VolumeUnits;
  stale: boolean;
  connected: boolean;
  loading: boolean;
  error: string | null;
  /** True specifically when the wall fetch failed with HTTP 404 (no such wall) — lets
   * WallPage show a "this wall doesn't exist" page distinct from a generic/transient
   * fetch failure. */
  notFound: boolean;
}

/**
 * Fetches a wall's config + initial tap snapshot via `getWall`, then hands live updates off
 * to `useTapStates`. Config doesn't ride the WS snapshot (only taps do), so we re-fetch it
 * whenever the socket reconnects — a cheap way to pick up wall edits made while disconnected.
 */
export function useWallData(slug: string | undefined): UseWallDataResult {
  const [wall, setWall] = useState<UseWallDataResult['wall']>(null);
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) {
      setWall(null);
      setInitialTaps([]);
      setUnits('us');
      setError(null);
      setNotFound(false);
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
        setUnits(result.data.units ?? 'us');
        setError(null);
        setNotFound(false);
      } else {
        setError(result.message);
        setNotFound(result.status === 404);
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
        setUnits(result.data.units ?? 'us');
        setError(null);
        setNotFound(false);
      } else {
        setError(result.message);
        setNotFound(result.status === 404);
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
    wall, taps, units, stale, connected, loading, error, notFound,
  };
}
