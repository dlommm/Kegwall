import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { TapState } from '../../server/core/state.js';
import { getMenu } from '../lib/api';
import { useTapStates } from '../lib/useTapStates';
import type { VolumeUnits } from '../lib/units';
import { ClaimPicker, ClaimSection, useClaimFlow } from '../components/ClaimSheet';
import { PassportCard } from '../components/PassportCard';
import { BeerSheet } from '../components/BeerSheet';
import { ThemeProvider } from '../themes/ThemeProvider';
import { TapMarker } from '../wall/TapMarker';
import { wallTapModel, type WallTapModel } from '../wall/wallModel';
import { initials } from '../lib/initials';
import {
  filterMenuTaps, isNewTap, onTapCount, type MenuFilter,
} from '../lib/menuFilter';
import { STYLE_FAMILIES, styleFamilyOf, type StyleFamily } from '../lib/styleFamily';
// Styles only this route tree uses (split out of index.css in Kegwall V2 M1).
import './menu.css';

type Chip = MenuFilter | StyleFamily;

const MENU_FILTERS: { key: MenuFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'low', label: 'Almost gone' },
];

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n: number) => NUMBER_WORDS[n] ?? String(n);

const unthemedFullScreen = 'flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 text-center text-neutral-100 px-4';

function matches(model: WallTapModel, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [model.name, model.brewery, model.style].some((v) => v?.toLowerCase().includes(q));
}

/** "Just tapped on tap 6. Wild Cellar's fruited sour, 6%. About 12 pints left." */
function heroLede(m: WallTapModel): string {
  const bits = [`Just tapped on tap ${m.tapNumber}.`];
  const what = [m.brewery ? `${m.brewery}’s` : null, m.style ?? 'beer'].filter(Boolean).join(' ');
  bits.push(`${what.charAt(0).toUpperCase()}${what.slice(1)}${m.abv != null ? `, ${m.abv}%` : ''}.`);
  if (m.servings != null && m.servings >= 1) bits.push(`About ${Math.round(m.servings)} ${m.servingNoun}s left.`);
  return bits.join(' ');
}

/**
 * `/menu` (Kegwall V2 M10, blueprint §E.5): the phone menu a guest reaches from the wall's QR.
 * The newest keg leads in its own color; then search, the All / New / Almost gone filters plus
 * style families (D7), and one row per beer with its name on its own line, style · ABV · IBU,
 * the tap marker and pints left (fixes issue 15). A row opens the beer sheet (issue 18).
 * Unclaimed pours get a sentence near the top and a bar that stays on screen.
 *
 * The menu isn't tied to a wall, so it always mounts with the default theme.
 */
export function MenuPage() {
  const [siteName, setSiteName] = useState<string | null>(null);
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [servingSizeMl, setServingSizeMl] = useState(473);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>('all');
  const [query, setQuery] = useState('');
  const [openTapId, setOpenTapId] = useState<number | null>(null);
  const claim = useClaimFlow();

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSiteName(result.data.siteName);
        setInitialTaps(result.data.taps);
        setUnits(result.data.units ?? 'us');
        if (result.data.servingSizeMl) setServingSizeMl(result.data.servingSizeMl);
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
  const taps = useMemo(() => allTaps.filter((t) => !t.hidden), [allTaps]);
  const models = useMemo(() => new Map(taps.map((t) => [t.tapId, wallTapModel(t, { units, servingSizeMl })])), [taps, units, servingSizeMl]);

  // The newest keg tapped this week leads the page in its own color.
  const hero = useMemo(() => {
    const fresh = taps.filter((t) => isNewTap(t)).sort((a, b) => (b.keg!.dateTapped! > a.keg!.dateTapped! ? 1 : -1));
    return fresh[0] ? models.get(fresh[0].tapId)! : null;
  }, [taps, models]);

  const familyCounts = useMemo(() => {
    const counts = new Map<StyleFamily, number>();
    for (const t of taps) {
      if (!t.beer || t.keg?.status === 'kicked') continue;
      const f = styleFamilyOf(t.beer.style, t.beer.srm);
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
  }, [taps]);

  const visible = useMemo(() => {
    const byChip = chip === 'all' || chip === 'new' || chip === 'low'
      ? filterMenuTaps(taps, chip)
      : taps.filter((t) => t.beer && styleFamilyOf(t.beer.style, t.beer.srm) === chip);
    return byChip.map((t) => models.get(t.tapId)!).filter((m) => matches(m, query.trim()));
  }, [taps, models, chip, query]);

  const openModel = openTapId != null ? models.get(openTapId) ?? null : null;
  const count = onTapCount(taps);
  const unclaimed = claim.pours.length;

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
          <header
            className={hero ? 'menu-hero menu-hero--feature' : 'menu-hero'}
            style={hero ? { '--feat': hero.beerColor, '--feat-ink': hero.markerInk } as CSSProperties : undefined}
          >
            <div className="menu-hero__bar">
              <h1 className="menu-hero__site" data-testid="menu-page-site-name">{siteName}</h1>
              {claim.remembered ? (
                <a className="menu-hero__passport" href="#passport" data-testid="menu-passport-chip">
                  <i aria-hidden="true">{initials(claim.remembered.name)}</i>
                  Passport
                </a>
              ) : (
                <span className="menu-hero__count" data-testid="menu-page-count">{`${count} on tap`}</span>
              )}
            </div>
            {hero && (
              <button type="button" className="menu-hero__feature" onClick={() => setOpenTapId(hero.tap.tapId)}>
                <span className="menu-hero__num" aria-hidden="true">{hero.tapNumber}</span>
                <span className="menu-hero__name">{hero.name}</span>
              </button>
            )}
          </header>

          <div className="menu-page__body">
            {hero && <p className="menu-page__lede">{heroLede(hero)}</p>}
            {claim.remembered && <p className="menu-page__count-line" data-testid="menu-page-count">{`${count} on tap`}</p>}

            {unclaimed > 0 && (
              <div className="menu-claim" data-testid="menu-claim-line">
                <span>
                  {`${unclaimed === 1 ? 'One pour' : `${word(unclaimed).charAt(0).toUpperCase()}${word(unclaimed).slice(1)} pours`} in the last few minutes ${unclaimed === 1 ? 'has' : 'have'} no name yet.`}
                </span>
                <button type="button" onClick={() => claim.openPour(claim.pours[0]!)}>Claim one</button>
              </div>
            )}

            <label className="menu-search">
              <span className="menu-sr">Search the beers</span>
              <input
                type="search"
                data-testid="menu-search"
                placeholder={`Search ${word(count)} ${count === 1 ? 'beer' : 'beers'}`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>

            <div className="menu-page__filters" role="group" aria-label="Filter taps" data-testid="menu-page-filters">
              {MENU_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="menu-page__filter-chip"
                  data-testid={`menu-filter-${f.key}`}
                  aria-pressed={chip === f.key}
                  onClick={() => setChip(f.key)}
                >
                  {f.label}
                </button>
              ))}
              {STYLE_FAMILIES.filter((f) => familyCounts.has(f.id)).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="menu-page__filter-chip"
                  data-testid={`menu-filter-${f.id}`}
                  aria-pressed={chip === f.id}
                  onClick={() => setChip(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <h2 className="menu-page__h2">On tap</h2>
            {visible.length === 0 ? (
              <p className="menu-page__empty" data-testid="menu-page-empty">
                {query.trim() ? `Nothing matches “${query.trim()}”.`
                  : chip === 'new' ? 'Nothing new right now.' : chip === 'low' ? 'Nothing running low.'
                    : chip === 'all' ? 'No taps pouring yet.' : 'Nothing in that style right now.'}
              </p>
            ) : (
              <ol className="menu-list" data-testid="menu-page-tap-list">
                {visible.map((m) => {
                  const meta = [`Tap ${m.tapNumber}`, m.style, m.abv != null ? `${m.abv}%` : null, m.ibu != null ? `${m.ibu} IBU` : null]
                    .filter(Boolean).join(' · ');
                  return (
                    <li key={m.tap.tapId}>
                      <button
                        type="button"
                        className={`menu-tap${m.isLow ? ' is-low' : ''}${m.isKicked || !m.hasBeer ? ' is-out' : ''}`}
                        data-testid="menu-tap"
                        disabled={!m.hasBeer}
                        onClick={() => setOpenTapId(m.tap.tapId)}
                      >
                        <TapMarker model={m} size={54} showNumber={false} />
                        <span className="menu-tap__text">
                          <span className="menu-tap__name" data-testid="menu-tap-name">{m.name ?? `Tap ${m.tapNumber} is empty`}</span>
                          <span className="menu-tap__meta">{m.hasBeer ? meta : 'Nothing on right now'}</span>
                          {m.pouring && m.pourLabel && (
                            <span className="menu-tap__pouring" data-testid="menu-tap-pouring">{`Pouring now · ${m.pourLabel}`}</span>
                          )}
                        </span>
                        {m.hasBeer && (
                          <span className="menu-tap__left">
                            <b>{m.isKicked ? '—' : m.servings != null && m.servings >= 1 ? Math.round(m.servings) : m.servings != null && m.servings > 0 ? '<1' : '—'}</b>
                            <span>{m.isKicked ? 'kicked' : `${m.servingNoun}s left`}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <div id="passport"><PassportCard /></div>
            <ClaimSection flow={claim} picker={false} />

            <footer className="menu-page__footer">
              <Link to="/admin" className="menu-page__admin-link" data-testid="menu-admin-link">
                Staff sign-in
              </Link>
            </footer>
          </div>

          {openModel && (
            <BeerSheet
              model={openModel}
              units={units}
              pours={claim.pours.filter((p) => p.tapNumber === openModel.tapNumber)}
              onClaim={(pour) => { setOpenTapId(null); claim.openPour(pour); }}
              onClose={() => setOpenTapId(null)}
            />
          )}
          <ClaimPicker flow={claim} />
        </main>
      )}
    </ThemeProvider>
  );
}
