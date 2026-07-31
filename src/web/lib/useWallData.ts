import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { getWall } from './api';
import { useTapStates } from './useTapStates';
import type { VolumeUnits } from './units';

export interface UseWallDataOptions {
  /** Phase 5 Task 4: threaded straight through to `useTapStates` -- see that hook's doc
   * comment. Lets WallPage subscribe to WS banner/theme_override messages over the SAME
   * socket useWallData already owns, instead of opening a second one. */
  onMessage?: (msg: unknown) => void;
}

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
 * whenever the socket reconnects (picks up edits made while disconnected) AND whenever the
 * server pushes `{type:'walls_changed'}` (any wall/config/device-assignment edit — see
 * ws.ts). The push is what keeps a kiosk TV current: it stays connected for weeks and
 * would otherwise never see a config change until someone power-cycled it.
 */
export function useWallData(
  slug: string | undefined,
  options: UseWallDataOptions = {},
): UseWallDataResult {
  const [wall, setWall] = useState<UseWallDataResult['wall']>(null);
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  // Device→wall scoping (strict): the tap ids this wall may show, resolved server-side
  // from wall_devices. null = an older server payload without the field (no filtering).
  const [allowedTapIds, setAllowedTapIds] = useState<number[] | null>(null);
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
        setAllowedTapIds(result.data.allowedTapIds ?? null);
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

  // Bumped on every walls_changed push; drives the refetch effect below alongside
  // reconnectCount.
  const [wallsVersion, setWallsVersion] = useState(0);
  const externalOnMessage = useRef(options.onMessage);
  externalOnMessage.current = options.onMessage;
  const handleMessage = useCallback((msg: unknown) => {
    if ((msg as { type?: string } | null)?.type === 'walls_changed') {
      setWallsVersion((v) => v + 1);
    }
    externalOnMessage.current?.(msg);
  }, []);

  const {
    taps: liveTaps, stale, connected, reconnectCount,
  } = useTapStates(initialTaps, { onMessage: handleMessage });

  // The /ws snapshot is GLOBAL (every tap in the install, no per-wall routing — see
  // routes/ws.ts), and useTapStates overwrites the REST-seeded list with it within
  // ~1s of mount. Re-applying the wall's allowed set here is therefore the single
  // choke point that keeps device scoping true for everything downstream: page
  // resolution, the auto-chunk path, takeover, max-temp, and the tablet's pouring
  // detection all read this hook's taps.
  const taps = useMemo(() => {
    // `hidden` is also filtered here (not just via allowedTapIds): a tap hidden while
    // the wall is open drops off on the very NEXT ws snapshot, without waiting for
    // the wall payload (and its allowedTapIds) to be refetched on reconnect.
    const visible = liveTaps.filter((t) => !t.hidden);
    if (allowedTapIds == null) return visible;
    const allowed = new Set(allowedTapIds);
    return visible.filter((t) => allowed.has(t.tapId));
  }, [liveTaps, allowedTapIds]);

  useEffect(() => {
    // Both counters are 0 on the initial mount (useTapStates only increments
    // reconnectCount after a prior successful open; wallsVersion only moves on a
    // server push), so this fires on genuine reconnects/pushes, never on mount.
    if (!slug || (reconnectCount === 0 && wallsVersion === 0)) return;

    let cancelled = false;
    getWall(slug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setWall(result.data.wall);
        setAllowedTapIds(result.data.allowedTapIds ?? null);
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
  }, [reconnectCount, wallsVersion]);

  return {
    wall, taps, units, stale, connected, loading, error, notFound,
  };
}
