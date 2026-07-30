import { useEffect, useState } from 'react';
import type { TapState } from '../../server/core/state.js';
import { getMenu } from '../lib/api';
import { useTapStates } from '../lib/useTapStates';
import type { VolumeUnits } from '../lib/units';
import { TapCard } from '../components/TapCard';
import { ClaimSheet } from '../components/ClaimSheet';
import { PassportCard } from '../components/PassportCard';
import { ThemeProvider } from '../themes/ThemeProvider';

const unthemedFullScreen = 'flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 text-center text-neutral-100 px-4';

/**
 * `/menu`: the mobile-first tap list a viewer lands on after scanning the wall's QR
 * overlay (see `QrOverlay`/`WallPage`). Fetches `siteName` + the initial tap snapshot via
 * `getMenu`, then hands live updates off to the same `useTapStates` hook the wall itself
 * uses — one live-data story for both surfaces. Taps render with the `compact` `TapCard`
 * template (a dense row, right for a scrolling phone list rather than the wall's big
 * grid). Below the list, `ClaimSheet` owns the "claim your pour" flow end to end.
 *
 * Unlike `WallPage`, there's no per-page theme config to wait on here — the menu isn't
 * tied to a specific wall, so it always mounts with the default (taproom) theme.
 */
export function MenuPage() {
  const [siteName, setSiteName] = useState<string | null>(null);
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSiteName(result.data.siteName);
        setInitialTaps(result.data.taps);
        setUnits(result.data.units ?? 'us');
        setError(null);
      } else {
        setError(result.message);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { taps: allTaps } = useTapStates(initialTaps);
  // Hidden taps never render on the public menu (they stay admin-only).
  const taps = allTaps.filter((t) => !t.hidden);

  return (
    <ThemeProvider className="menu-page">
      {loading && (
        <main className={unthemedFullScreen} data-testid="menu-page-loading">
          <p>Loading the menu…</p>
        </main>
      )}

      {!loading && error && (
        <main className={unthemedFullScreen} data-testid="menu-page-error">
          <h1 className="font-display text-2xl">Menu unavailable</h1>
          <p className="text-neutral-300">{error}</p>
        </main>
      )}

      {!loading && !error && (
        <main className="menu-page__content" data-testid="menu-page">
          <header className="menu-page__header">
            <h1 className="menu-page__site-name font-display" data-testid="menu-page-site-name">
              {siteName}
            </h1>
          </header>

          <ul className="menu-page__tap-list" data-testid="menu-page-tap-list">
            {taps.map((tap) => (
              <li key={tap.tapId}>
                <TapCard tap={tap} template="compact" units={units} />
              </li>
            ))}
          </ul>

          <>
            <PassportCard />
            <ClaimSheet />
          </>
        </main>
      )}
    </ThemeProvider>
  );
}
