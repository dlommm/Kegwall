import { useCallback, useRef, useState } from 'react';
import type { Pour, Keg } from '../../../server/db/kegs.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Tap } from '../../../server/db/taps.js';
import {
  listRecentPours, listBeers, listKegs, listTaps, setPourDrinker, setPoursDrinker,
  type PourQuery,
} from '../../lib/adminApi';
import { usePolledFetch } from '../../lib/usePolledFetch';
import { getDrinkers, type PublicDrinker } from '../../lib/api';
import { formatVolumeMl } from '../../lib/units';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { useAdminContext } from './useAdminContext';

type PageStatus = 'loading' | 'loaded' | 'error';

/** Rows per fetch; "Load more" pages further back with a keyset cursor. */
export const POURS_PAGE_SIZE = 100;
/** The endpoint's max `limit` — a poll re-reads at most this many already-loaded rows. */
const MAX_POLL_ROWS = 2000;

interface Filters {
  unclaimedOnly: boolean;
  /** '' = everyone; otherwise a drinker id. Ignored while `unclaimedOnly` is on. */
  drinkerId: string;
  /** Local calendar dates (`YYYY-MM-DD`), inclusive; '' = open-ended. */
  from: string;
  to: string;
}

const NO_FILTERS: Filters = {
  unclaimedOnly: false, drinkerId: '', from: '', to: '',
};

function tapLabel(tap: Tap | undefined): string {
  if (!tap) return '—';
  return tap.name ?? `Tap ${tap.number}`;
}

/** Server query for the filter bar. Dates are local days, sent as UTC ISO bounds. */
export function pourQueryFor(filters: Filters): PourQuery {
  const query: PourQuery = {};
  if (filters.unclaimedOnly) query.unclaimed = true;
  else if (filters.drinkerId) query.drinkerId = Number(filters.drinkerId);
  if (filters.from) query.since = new Date(`${filters.from}T00:00:00`).toISOString();
  if (filters.to) query.until = new Date(`${filters.to}T23:59:59.999`).toISOString();
  return query;
}

/** Recent pours read as "12 min ago"; anything a day or older reads as a date, since
 * "3 days ago" is hard to match against a party or a guest's memory. */
export function formatPourTime(ts: string, now: Date = new Date()): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  if (now.getTime() - date.getTime() < 24 * 3600 * 1000) return formatRelativeTime(ts, now);
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** True when a pour still belongs in the list after its drinker changed. */
function matchesFilters(pour: Pour, filters: Filters): boolean {
  if (filters.unclaimedOnly) return pour.drinkerId === null;
  if (filters.drinkerId) return pour.drinkerId === Number(filters.drinkerId);
  return true;
}

/**
 * `/admin/pours`: every recorded pour, newest first, for reviewing and fixing claims.
 * Guests can only claim within the public claim window; everything older is assigned here.
 *
 * Filters (unclaimed only, drinker, date range) apply on the server before the page
 * limit, so an old unclaimed pour is never hidden behind newer claimed activity. "Load
 * more" pages back with a `beforeId` keyset cursor; the 15s poll re-reads however many
 * rows are loaded, so it never collapses a long list back to the first page.
 *
 * Joins against the viewer-readable beers/kegs/taps catalog endpoints plus the public
 * `getDrinkers()` list (the same non-sensitive source the claim sheet uses).
 *
 * A viewer sees each pour's drinker as plain text. An editor+ gets a per-row `<select>`
 * that reassigns or unclaims immediately (`PATCH /api/pours/:id/drinker`), and row
 * checkboxes for a bulk assign/unclaim (`PATCH /api/pours/drinker`, one transaction).
 * Failures show inline and leave the controlled selects on the unchanged server value.
 */
export function PoursPage() {
  const { me, units } = useAdminContext();
  const canEdit = me.role === 'editor' || me.role === 'admin';

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [pours, setPours] = useState<Pour[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [drinkers, setDrinkers] = useState<PublicDrinker[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Any write or filter change bumps the generation so an in-flight read can't
  // overwrite newer state with a stale snapshot.
  const loadGeneration = useRef(0);
  const loadedCount = useRef(0);
  loadedCount.current = pours.length;
  const busy = savingId !== null || bulkSaving || loadingMore;

  const load = useCallback((isCancelled: () => boolean = () => false) => {
    const generation = ++loadGeneration.current;
    const limit = Math.min(MAX_POLL_ROWS, Math.max(POURS_PAGE_SIZE, loadedCount.current));
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    Promise.all([
      listRecentPours({ ...pourQueryFor(filters), limit }), listBeers(), listKegs(), listTaps(), getDrinkers(),
    ]).then(([poursRes, beersRes, kegsRes, tapsRes, drinkersRes]) => {
      if (isCancelled() || generation !== loadGeneration.current) return;
      if (poursRes.ok) {
        setPours(poursRes.data);
        setHasMore(poursRes.data.length >= limit);
        const visible = new Set(poursRes.data.map((p) => p.id));
        setSelected((prev) => {
          const next = new Set([...prev].filter((id) => visible.has(id)));
          return next.size === prev.size ? prev : next;
        });
      }
      if (beersRes.ok) setBeers(beersRes.data);
      if (kegsRes.ok) setKegs(kegsRes.data);
      if (tapsRes.ok) setTaps(tapsRes.data);
      if (drinkersRes.ok) setDrinkers(drinkersRes.data);
      const allOk = poursRes.ok && beersRes.ok && kegsRes.ok && tapsRes.ok && drinkersRes.ok;
      setStatus(allOk ? 'loaded' : 'error');
    });
  }, [filters]);

  usePolledFetch((isCancelled) => { if (!busy) load(isCancelled); }, { intervalMs: 15_000, restartKey: filters });

  function updateFilters(patch: Partial<Filters>) {
    ++loadGeneration.current;
    loadedCount.current = 0;
    setPours([]);
    setSelected(new Set());
    setBulkMessage(null);
    setStatus('loading');
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  async function loadMore() {
    const last = pours[pours.length - 1];
    if (!last) return;
    const generation = ++loadGeneration.current;
    setLoadingMore(true);
    const result = await listRecentPours({ ...pourQueryFor(filters), beforeId: last.id, limit: POURS_PAGE_SIZE });
    setLoadingMore(false);
    if (generation !== loadGeneration.current) return;
    if (!result.ok) {
      setBulkMessage({ kind: 'error', text: `Couldn’t load older pours: ${result.message}` });
      return;
    }
    setPours((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...result.data.filter((p) => !seen.has(p.id))];
    });
    setHasMore(result.data.length >= POURS_PAGE_SIZE);
  }

  const kegById = new Map(kegs.map((k) => [k.id, k]));
  const beerById = new Map(beers.map((b) => [b.id, b]));
  const tapById = new Map(taps.map((t) => [t.id, t]));
  const drinkerById = new Map(drinkers.map((d) => [d.id, d]));

  function applyUpdated(updated: Pour[]) {
    const byId = new Map(updated.map((p) => [p.id, p]));
    setPours((prev) => prev
      .map((p) => byId.get(p.id) ?? p)
      .filter((p) => !byId.has(p.id) || matchesFilters(p, filters)));
  }

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
      applyUpdated([result.data]);
      return;
    }
    setRowErrors((prev) => ({ ...prev, [pourId]: result.message }));
  }

  async function handleBulkApply() {
    if (selected.size === 0 || bulkTarget === '') return;
    const drinkerId = bulkTarget === 'unclaim' ? null : Number(bulkTarget);
    const ids = [...selected];
    ++loadGeneration.current;
    setBulkSaving(true);
    setBulkMessage(null);
    const result = await setPoursDrinker(ids, drinkerId);
    setBulkSaving(false);
    if (!result.ok) {
      setBulkMessage({ kind: 'error', text: result.message });
      return;
    }
    applyUpdated(result.data);
    setSelected(new Set());
    setBulkTarget('');
    const who = drinkerId === null ? null : drinkerById.get(drinkerId)?.displayName ?? 'the drinker';
    const count = result.data.length;
    setBulkMessage({
      kind: 'ok',
      text: who
        ? `Assigned ${count} pour${count === 1 ? '' : 's'} to ${who}.`
        : `Unclaimed ${count} pour${count === 1 ? '' : 's'}.`,
    });
  }

  function toggleSelected(pourId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pourId)) next.delete(pourId); else next.add(pourId);
      return next;
    });
  }

  const allSelected = pours.length > 0 && pours.every((p) => selected.has(p.id));
  const filtered = filters.unclaimedOnly || filters.drinkerId !== '' || filters.from !== '' || filters.to !== '';
  const now = new Date();

  return (
    <section data-testid="admin-pours-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Pours</h1>
      </header>
      <p className="admin-page-quiet">
        Every recorded pour, newest first. Guests can only claim a pour for a few minutes, so older
        ones are assigned here. {canEdit && 'Change a drinker on a row, or tick several rows to assign them together.'}
      </p>

      <div className="pours-toolbar" data-testid="pours-filters">
        <label className="pours-toolbar__check">
          <input
            type="checkbox"
            checked={filters.unclaimedOnly}
            disabled={busy}
            onChange={(event) => updateFilters({ unclaimedOnly: event.target.checked })}
          />
          Unclaimed only
        </label>
        <label className="pours-toolbar__field">
          <span>Drinker</span>
          <select
            data-testid="pours-filter-drinker"
            value={filters.unclaimedOnly ? '' : filters.drinkerId}
            disabled={busy || filters.unclaimedOnly}
            onChange={(event) => updateFilters({ drinkerId: event.target.value })}
          >
            <option value="">Everyone</option>
            {drinkers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
        </label>
        <label className="pours-toolbar__field">
          <span>From</span>
          <input
            type="date"
            data-testid="pours-filter-from"
            value={filters.from}
            max={filters.to || undefined}
            disabled={busy}
            onChange={(event) => updateFilters({ from: event.target.value })}
          />
        </label>
        <label className="pours-toolbar__field">
          <span>To</span>
          <input
            type="date"
            data-testid="pours-filter-to"
            value={filters.to}
            min={filters.from || undefined}
            disabled={busy}
            onChange={(event) => updateFilters({ to: event.target.value })}
          />
        </label>
        {filtered && (
          <button type="button" data-testid="pours-filter-clear" disabled={busy} onClick={() => updateFilters(NO_FILTERS)}>
            Clear filters
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => load()}>Refresh</button>
      </div>

      {canEdit && selected.size > 0 && (
        <div className="pours-bulk" data-testid="pours-bulk-bar" role="region" aria-label="Bulk assign">
          <span className="pours-bulk__count font-tabular" data-testid="pours-bulk-count">
            {selected.size} selected
          </span>
          <label className="pours-toolbar__field">
            <span>Assign to</span>
            <select
              data-testid="pours-bulk-target"
              value={bulkTarget}
              disabled={bulkSaving}
              onChange={(event) => setBulkTarget(event.target.value)}
            >
              <option value="">Choose…</option>
              <option value="unclaim">Unclaimed (clear drinker)</option>
              {drinkers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="pours-bulk__apply"
            data-testid="pours-bulk-apply"
            disabled={bulkSaving || bulkTarget === ''}
            onClick={handleBulkApply}
          >
            {bulkSaving ? 'Saving…' : 'Apply'}
          </button>
          <button type="button" disabled={bulkSaving} onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
      {bulkMessage && (
        <p
          className={bulkMessage.kind === 'error' ? 'pours-bulk__message pours-bulk__message--error' : 'pours-bulk__message'}
          role={bulkMessage.kind === 'error' ? 'alert' : 'status'}
          data-testid="pours-bulk-message"
        >
          {bulkMessage.text}
        </p>
      )}

      {status === 'loading' && <p className="admin-page-quiet" data-testid="pours-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="pours-error">
          Couldn&rsquo;t load pours. Use Refresh to try again.
        </p>
      )}
      {status === 'loaded' && pours.length === 0 && (
        <p className="admin-page-quiet" data-testid="pours-empty">
          {filtered ? 'No pours match these filters.' : 'No pours recorded yet.'}
        </p>
      )}

      {status !== 'loading' && pours.length > 0 && (
        <>
          <div className="pours-table-wrap">
            <table className="admin-table" data-testid="pours-table">
              <thead>
                <tr>
                  {canEdit && (
                    <th scope="col" className="pours-table__select">
                      <label className="pours-select-hit">
                        <input
                          type="checkbox"
                          data-testid="pours-select-all"
                          aria-label={allSelected ? 'Deselect all loaded pours' : 'Select all loaded pours'}
                          checked={allSelected}
                          disabled={bulkSaving}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(pours.map((p) => p.id)))}
                        />
                      </label>
                    </th>
                  )}
                  <th scope="col" className="pours-col--secondary">Time</th>
                  <th scope="col" className="pours-col--secondary">Tap</th>
                  <th scope="col">Beer</th>
                  <th scope="col" className="pours-col--secondary">Volume</th>
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
                  const isSelected = selected.has(pour.id);
                  return (
                    <tr key={pour.id} data-testid="pours-row" data-selected={isSelected || undefined}>
                      {canEdit && (
                        <td className="pours-table__select">
                          <label className="pours-select-hit">
                            <input
                              type="checkbox"
                              data-testid="pours-row-select"
                              aria-label={`Select pour from ${formatPourTime(pour.ts, now)}`}
                              checked={isSelected}
                              disabled={bulkSaving}
                              onChange={() => toggleSelected(pour.id)}
                            />
                          </label>
                        </td>
                      )}
                      <td className="font-tabular pours-col--secondary">
                        <time dateTime={pour.ts} title={new Date(pour.ts).toLocaleString()} data-testid="pours-row-time">
                          {formatPourTime(pour.ts, now)}
                        </time>
                      </td>
                      <td className="pours-col--secondary">{tapLabel(tap)}</td>
                      <td className="pours-col--beer">
                        {beer?.name ?? 'Unknown'}
                        <span className="pours-row__mobile-meta font-tabular">
                          {formatPourTime(pour.ts, now)} · {formatVolumeMl(pour.volumeMl, units)}
                        </span>
                      </td>
                      <td className="font-tabular pours-col--secondary">{formatVolumeMl(pour.volumeMl, units)}</td>
                      <td>
                        {canEdit ? (
                          <>
                            <select
                              data-testid="pours-row-drinker-select"
                              aria-label="Drinker"
                              value={pour.drinkerId != null ? String(pour.drinkerId) : ''}
                              disabled={savingId !== null || bulkSaving}
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
          </div>
          <div className="pours-footer">
            <span className="admin-page-quiet font-tabular" data-testid="pours-count">
              Showing {pours.length} pour{pours.length === 1 ? '' : 's'}
            </span>
            {hasMore && (
              <button type="button" data-testid="pours-load-more" disabled={busy} onClick={loadMore}>
                {loadingMore ? 'Loading…' : 'Load older pours'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
