import { useCallback, useRef, useState } from 'react';
import type { Pour, Keg } from '../../../server/db/kegs.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Tap } from '../../../server/db/taps.js';
import {
  listRecentPours, listBeers, listKegs, listTaps, setPourDrinker,
} from '../../lib/adminApi';
import { usePolledFetch } from '../../lib/usePolledFetch';
import { getDrinkers, type PublicDrinker } from '../../lib/api';
import { formatVolumeMl } from '../../lib/units';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { useAdminContext } from './useAdminContext';

type PageStatus = 'loading' | 'loaded' | 'error';

function tapLabel(tap: Tap | undefined): string {
  if (!tap) return '—';
  return tap.name ?? `Tap ${tap.number}`;
}

/**
 * `/admin/pours` (Phase 5 Task 0 — Phase 4 final review "admin pour reassignment /
 * unclaim" carry-over): a recent-pours table reached from the sidebar and dashboard.
 * The unclaimed filter applies on the server before the result limit.
 * Joins `GET /api/pours?limit=100` against the already-viewer-readable beers/kegs/taps
 * catalog endpoints (all fetched here client-side — the plan calls this a "simple" table,
 * and these are small local tables, same "cheap client-side join" precedent as
 * DashboardPage's activity feed) plus the public `getDrinkers()` list (same non-sensitive
 * source the wall's claim sheet uses — no admin-only drinker-listing endpoint exists).
 *
 * A viewer sees each pour's claimed drinker as plain text ("Unclaimed" when none); an
 * editor+ gets a `<select>` that reassigns or unclaims immediately on change (`PATCH
 * /api/pours/:id/drinker`, `setPourDrinker`) — no separate save step, matching how small
 * a "simple pours table" action is meant to be. A per-row failure shows a row-scoped
 * error and the select reverts (it's controlled by the still-unchanged `pour.drinkerId`).
 */
export function PoursPage() {
  const { me, units } = useAdminContext();
  const canEdit = me.role === 'editor' || me.role === 'admin';

  const [unclaimedOnly, setUnclaimedOnly] = useState(false);
  const [pours, setPours] = useState<Pour[]>([]);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [drinkers, setDrinkers] = useState<PublicDrinker[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadGeneration = useRef(0);
  const load = useCallback((isCancelled: () => boolean = () => false) => {
    const generation = ++loadGeneration.current;
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    Promise.all([
      listRecentPours(unclaimedOnly), listBeers(), listKegs(), listTaps(), getDrinkers(),
    ]).then(([poursRes, beersRes, kegsRes, tapsRes, drinkersRes]) => {
      if (isCancelled() || generation !== loadGeneration.current) return;
      if (poursRes.ok) setPours(poursRes.data);
      if (beersRes.ok) setBeers(beersRes.data);
      if (kegsRes.ok) setKegs(kegsRes.data);
      if (tapsRes.ok) setTaps(tapsRes.data);
      if (drinkersRes.ok) setDrinkers(drinkersRes.data);
      const allOk = poursRes.ok && beersRes.ok && kegsRes.ok && tapsRes.ok && drinkersRes.ok;
      setStatus(allOk ? 'loaded' : 'error');
    });
  }, [unclaimedOnly]);

  usePolledFetch((isCancelled) => { if (savingId === null) load(isCancelled); }, { intervalMs: 15_000, restartKey: unclaimedOnly });

  const kegById = new Map(kegs.map((k) => [k.id, k]));
  const beerById = new Map(beers.map((b) => [b.id, b]));
  const tapById = new Map(taps.map((t) => [t.id, t]));
  const drinkerById = new Map(drinkers.map((d) => [d.id, d]));

  async function handleDrinkerChange(pourId: number, rawValue: string) {
    const drinkerId = rawValue === '' ? null : Number(rawValue);
    ++loadGeneration.current;
    setSavingId(pourId);
    setRowErrors((prev) => {
      if (!(pourId in prev)) return prev;
      const next = { ...prev };
      delete next[pourId];
      return next;
    });
    const result = await setPourDrinker(pourId, drinkerId);
    setSavingId(null);
    if (result.ok) {
      setPours((prev) => prev.map((p) => (p.id === pourId ? result.data : p)).filter((p) => !unclaimedOnly || p.drinkerId === null));
      return;
    }
    setRowErrors((prev) => ({ ...prev, [pourId]: result.message }));
  }

  return (
    <section data-testid="admin-pours-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Pours</h1>
      </header>
      <p className="admin-page-quiet">
        The 100 most recent {unclaimedOnly ? 'unclaimed ' : ''}pours. Older pours can still be assigned here. {canEdit && 'Reassign or unclaim a drinker below.'}
      </p>

      <div className="pours-toolbar">
        <label>
          <input
            type="checkbox"
            checked={unclaimedOnly}
            disabled={savingId !== null}
            onChange={(event) => { setStatus('loading'); setUnclaimedOnly(event.target.checked); }}
          />
          Unclaimed only
        </label>
        <button type="button" disabled={savingId !== null} onClick={() => load()}>Refresh pours</button>
      </div>
      {status === 'loading'  && <p className="admin-page-quiet" data-testid="pours-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="pours-error">
          Couldn&rsquo;t load pours. Reload to try again.
        </p>
      )}
      {status === 'loaded' && pours.length === 0 && (
        <p className="admin-page-quiet" data-testid="pours-empty">{unclaimedOnly ? 'No unclaimed pours.' : 'No pours recorded yet.'}</p>
      )}

      {status === 'loaded' && pours.length > 0 && (
        <table className="admin-table" data-testid="pours-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Tap</th>
              <th scope="col">Beer</th>
              <th scope="col">Volume</th>
              <th scope="col">Drinker</th>
            </tr>
          </thead>
          <tbody>
            {pours.map((pour) => {
              const keg = kegById.get(pour.kegId);
              const beer = keg ? beerById.get(keg.beerId) : undefined;
              const tap = keg?.tapId != null ? tapById.get(keg.tapId) : undefined;
              const drinker = pour.drinkerId != null ? drinkerById.get(pour.drinkerId) : undefined;
              const rowError = rowErrors[pour.id];
              return (
                <tr key={pour.id} data-testid="pours-row">
                  <td className="font-tabular">{formatRelativeTime(pour.ts)}</td>
                  <td>{tapLabel(tap)}</td>
                  <td>{beer?.name ?? 'Unknown'}</td>
                  <td className="font-tabular">{formatVolumeMl(pour.volumeMl, units)}</td>
                  <td>
                    {canEdit ? (
                      <>
                        <select
                          data-testid="pours-row-drinker-select"
                          value={pour.drinkerId != null ? String(pour.drinkerId) : ''}
                          disabled={savingId !== null}
                          onChange={(e) => handleDrinkerChange(pour.id, e.target.value)}
                        >
                          <option value="">Unclaimed</option>
                          {drinkers.map((d) => (
                            <option key={d.id} value={d.id}>{d.displayName}</option>
                          ))}
                        </select>
                        {rowError && (
                          <p role="alert" className="pours-row__error" data-testid="pours-row-error">
                            {rowError}
                          </p>
                        )}
                      </>
                    ) : (
                      <span data-testid="pours-row-drinker-text">
                        {drinker ? drinker.displayName : 'Unclaimed'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
