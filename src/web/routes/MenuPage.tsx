import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { TapState } from '../../server/core/state.js';
import { getMenu, type PublicTap } from '../lib/api';
import { useTapStates } from '../lib/useTapStates';
import type { VolumeUnits } from '../lib/units';
import { TapCard } from '../components/TapCard';
import { ClaimSheet } from '../components/ClaimSheet';
import { PassportCard } from '../components/PassportCard';
import { ThemeProvider } from '../themes/ThemeProvider';
import {
  filterMenuTaps, onTapCount, type MenuFilter,
} from '../lib/menuFilter';
// Styles only this route tree uses (split out of index.css in Kegwall V2 M1).
import './menu.css';

const MENU_FILTERS: { key: MenuFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'low', label: 'Almost gone' },
];

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
  const [filter, setFilter] = useState<MenuFilter>('all');

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
  const visibleTaps = filterMenuTaps(taps, filter);

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
            <span className="menu-page__count-pill font-tabular" data-testid="menu-page-count">
              {`${onTapCount(taps)} on tap`}
            </span>
          </header>

          <div className="menu-page__filters" role="group" aria-label="Filter taps" data-testid="menu-page-filters">
            {MENU_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="menu-page__filter-chip"
                data-testid={`menu-filter-${f.key}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {visibleTaps.length === 0 ? (
            <p className="menu-page__empty" data-testid="menu-page-empty">
              {filter === 'new' ? 'Nothing new right now.' : filter === 'low' ? 'Nothing running low.' : 'No taps pouring yet.'}
            </p>
          ) : (
            <ul className="menu-page__tap-list" data-testid="menu-page-tap-list">
              {visibleTaps.map((tap) => (
                <li key={tap.tapId}>
                  <TapCard tap={tap} template="compact" units={units} pricePerPintCents={(tap as PublicTap).pricePerPintCents ?? null} />
                </li>
              ))}
            </ul>
          )}

          <>
            <PassportCard />
            <ClaimSheet />
          </>

          <footer className="menu-page__footer">
            <Link to="/admin" className="menu-page__admin-link" data-testid="menu-admin-link">
              ⚙ Admin
            </Link>
          </footer>
        </main>
      )}
    </ThemeProvider>
  );
}
