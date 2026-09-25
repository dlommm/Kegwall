import { useSearchParams } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Tap } from '../../../server/db/taps.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import type { MonitorWithDeviceKeg } from '../../lib/adminApi';
import type { KegBurnStat } from '../../../server/db/stats.js';
import type { CleaningStatus } from '../../../server/db/cleanings.js';
import {
  listBeers, listKegs, listMonitors, listTaps, deleteTap as deleteTapApi,
  getActiveKegStats, getCleaningStatuses, logTapCleaning, setCleaningReminders,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { formatWholeVolume } from '../../lib/lookData';
import { matchKegType } from '../../lib/kegAssets';
import { kicksSoon } from '../../lib/kegForecast';
import { cleaningProgress, kickTimelinePct } from '../../lib/tapMeters';
import { KegSilhouette } from '../../components/glyphs/KegSilhouette';
import { TapForm } from './TapForm';
import { SwapWizard } from './SwapWizard';
import { OnDeckQueue } from './OnDeckQueue';
import { KickedHistory } from './KickedHistory';
import { useAdminContext } from './useAdminContext';

type TapFormState = { mode: 'create' } | { mode: 'edit'; tap: Tap } | null;
interface DeleteTapState { tap: Tap; error: string | null }
interface WizardState { tap: TapState; promoteKeg: Keg | null }

/** `TapState` (the `/ws`-live snapshot every tap row is rendered from) has no
 * `defaultDrinkerId` — that's admin configuration, not live device state (see
 * db/taps.ts's doc comment), so it's not part of the public-facing `TapState` shape. The
 * edit form still needs the tap's REAL current value, so this resolves it against
 * `tapRows` — the plain `GET /api/taps` listing this page also loads (Phase 5 Task 0) —
 * falling back to `null` for the brief window before that load resolves. */
function tapToPlainTap(tap: TapState, tapRows: Tap[]): Tap {
  const row = tapRows.find((r) => r.id === tap.tapId);
  return {
    id: tap.tapId, number: tap.tapNumber, name: tap.tapName,
    defaultDrinkerId: row?.defaultDrinkerId ?? null,
    hidden: row?.hidden ?? false,
  };
}

/** "Kicks in ~N days at current pace" (design 5b) from a keg's projected kick
 * date; null when there's no burn to project from. */
function kickDaysLabel(stat: KegBurnStat | undefined, now: Date = new Date()): string | null {
  if (!stat?.projectedKickDate) return null;
  const kick = new Date(`${stat.projectedKickDate}T00:00:00`);
  const days = Math.max(0, Math.round((kick.getTime() - now.getTime()) / (24 * 3600 * 1000)));
  return `Kicks in ~${days} day${days === 1 ? '' : 's'} at current pace`;
}

const KEG_TYPE_LABELS: Record<string, string> = {
  'half-barrel': 'Half barrel',
  'quarter-barrel': 'Quarter barrel',
  'sixth-barrel': 'Sixth barrel',
  'fifty-liter': '50 L',
  cornelius: 'Corny',
  'slim-quarter': 'Slim quarter',
  'mini-keg': 'Mini keg',
};

/**
 * `/admin/taps` (Task 5): the taps list (with a live level pill fed by the same `/ws`
 * snapshot the wall uses), tap CRUD, the keg swap wizard, and — per tap, behind an
 * expand toggle — the on-deck queue and kicked history. A viewer sees the list and the
 * expandable detail panels read-only: no Add/Edit/Delete/Swap controls, and the on-deck
 * queue's add/remove/promote controls are hidden the same way `canEdit` gates BeersPage.
 */
export function TapsPage() {
  const { me, units } = useAdminContext();
  const [searchParams] = useSearchParams();
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [monitors, setMonitors] = useState<MonitorWithDeviceKeg[]>([]);
  const [tapRows, setTapRows] = useState<Tap[]>([]);
  const [tapsStatus, setTapsStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [expandedTapId, setExpandedTapId] = useState<number | null>(() => {
    const tapId = Number(searchParams.get('tap'));
    return Number.isInteger(tapId) && tapId > 0 ? tapId : null;
  });
  const [tapFormState, setTapFormState] = useState<TapFormState>(null);
  const [deleteState, setDeleteState] = useState<DeleteTapState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  // Backdated line-cleaning dialog (redesign 4a). `when` is a YYYY-MM-DD date, or '' = just now.
  const [cleaningDialog, setCleaningDialog] = useState<{ tapId: number; when: string } | null>(null);
  const [cleaningError, setCleaningError] = useState<string | null>(null);
  const [reminderSaving, setReminderSaving] = useState<number | null>(null);
  const [cleaningSaving, setCleaningSaving] = useState(false);
  const [kegStats, setKegStats] = useState<KegBurnStat[]>([]);
  const [cleanings, setCleanings] = useState<CleaningStatus[]>([]);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setInitialTaps(result.data.taps);
        setTapsStatus('loaded');
      } else {
        setTapsStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { taps } = useTapStates(initialTaps);

  // Beers/kegs/monitors/tapRows don't ride the /ws snapshot (only tap-level live state
  // does) — this reloads all four whenever `dataRefreshKey` is bumped (after a swap, a
  // tap edit, or any other action that could have changed what the swap wizard/on-deck
  // queue/edit form need). `tapRows` (Phase 5 Task 0) is the plain `Tap` listing —
  // `defaultDrinkerId` isn't part of the live `TapState` shape (see `tapToPlainTap`).
  const loadCatalogData = useCallback(() => {
    listBeers().then((result) => { if (result.ok) setBeers(result.data); });
    listKegs().then((result) => { if (result.ok) setKegs(result.data); });
    listMonitors().then((result) => { if (result.ok) setMonitors(result.data); });
    listTaps().then((result) => { if (result.ok) setTapRows(result.data); });
    // Depletion forecast for the "Kicks in ~N days" line (design 5b).
    getActiveKegStats().then((result) => { if (result.ok) setKegStats(result.data); });
    // Line-cleaning due state (Phase 6, design 6e).
    getCleaningStatuses().then((result) => { if (result.ok) setCleanings(result.data); });
  }, []);

  useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData, dataRefreshKey]);

  const refresh = useCallback(() => setDataRefreshKey((k) => k + 1), []);

  const canEdit = me.role === 'editor' || me.role === 'admin';

  function handleTapSaved() {
    setTapFormState(null);
    refresh();
  }

  async function handleLogCleaning() {
    if (!cleaningDialog) return;
    setCleaningSaving(true);
    setCleaningError(null);
    // A backdated date is logged at local noon so it lands on the intended calendar day
    // regardless of timezone; blank = "just now" (server stamps the real time).
    const cleanedAt = cleaningDialog.when
      ? new Date(`${cleaningDialog.when}T12:00:00`).toISOString()
      : undefined;
    const result = await logTapCleaning(cleaningDialog.tapId, { cleanedAt });
    setCleaningSaving(false);
    if (result.ok) {
      setCleaningDialog(null);
      refresh();
    } else {
      setCleaningError(result.message);
    }
  }

  async function handleReminders(tapId: number, ignored: boolean) {
    setReminderSaving(tapId);
    setCleaningError(null);
    const result = await setCleaningReminders(tapId, ignored);
    setReminderSaving(null);
    if (result.ok) setCleanings((statuses) => statuses.map((status) => status.tapId === tapId ? result.data : status));
    else setCleaningError(result.message);
  }

  /** YYYY-MM-DD for N days ago, local — for the dialog's quick-picks. */
  function daysAgoDate(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function handleConfirmDeleteTap() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deleteTapApi(deleteState.tap.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteState(null);
      refresh();
      return;
    }
    setDeleteState({ ...deleteState, error: result.message });
  }

  return (
    <section data-testid="admin-taps-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Taps &amp; kegs</h1>
        {canEdit && !tapFormState && (
          <button
            type="button"
            className="admin-page-header__action"
            data-testid="taps-add-button"
            onClick={() => setTapFormState({ mode: 'create' })}
          >
            Add tap
          </button>
        )}
      </header>

      {tapFormState && canEdit && (
        <TapForm
          key={tapFormState.mode === 'edit' ? tapFormState.tap.id : 'create'}
          mode={tapFormState.mode}
          tap={tapFormState.mode === 'edit' ? tapFormState.tap : null}
          onSaved={handleTapSaved}
          onCancel={() => setTapFormState(null)}
        />
      )}

      {tapsStatus === 'loading' && <p className="admin-page-quiet" data-testid="taps-loading">Loading…</p>}
      {tapsStatus === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="taps-error">
          Couldn&rsquo;t load taps. Reload to try again.
        </p>
      )}
      {tapsStatus === 'loaded' && taps.length === 0 && (
        <p className="admin-page-quiet" data-testid="taps-empty">No taps yet.</p>
      )}

      {tapsStatus === 'loaded' && taps.length > 0 && (
        <ul className="taps-list" data-testid="taps-list">
          {taps.map((tap) => {
            const isKicked = tap.keg?.status === 'kicked';
            const hasActiveKeg = tap.keg != null && tap.keg.status === 'on_tap';
            const levelPct = tap.keg && !isKicked ? tap.keg.levelPct : 0;
            const expanded = expandedTapId === tap.tapId;
            const stat = tap.keg ? kegStats.find((s) => s.kegId === tap.keg!.id) : undefined;
            // Redesign 3d: a keg projected to kick within 3 days reads danger-red, and its Swap
            // becomes the accent primary action.
            const kickSoon = !isKicked && stat ? kicksSoon(stat.projectedKickDate) : false;
            const kegType = tap.keg ? tap.keg.kegType ?? matchKegType(tap.keg.sizeMl) : null;
            const isLow = !isKicked && tap.keg != null && levelPct <= 15;
            const ML_PER_PINT = 473.176;
            return (
              <li key={tap.tapId} className="taps-row" data-testid="taps-row" data-kicked={isKicked}>
                <div className="taps-row__main">
                  <span className="taps-row__glyph" aria-hidden="true">
                    <KegSilhouette levelPct={Math.round(levelPct)} kegType={kegType} width={78} />
                  </span>
                  <span className="taps-row__info">
                    <span className="taps-row__tap-line">
                      <span className="taps-row__number font-tabular">{`TAP ${tap.tapNumber}`}</span>
                      {tap.tapName && <span className="taps-row__name">{tap.tapName}</span>}
                      {isLow && <span className="look-badge look-badge--low">ALMOST GONE</span>}
                      {isKicked && <span className="look-badge look-badge--kicked">KICKED</span>}
                      {tap.hidden && (
                        <span className="look-badge look-badge--kicked" data-testid="taps-row-hidden">HIDDEN</span>
                      )}
                      {/* DESIGN NOTE: the "surprise" CLEANING DUE badge is replaced by the
                          cleaning meter in the details panel below (README 3d). */}
                    </span>
                    <span className="taps-row__beer font-display">
                      {tap.beer ? tap.beer.name : 'Empty'}
                    </span>
                    <span className="taps-row__meta">
                      {[
                        tap.beer?.style,
                        tap.beer?.abv != null ? `${tap.beer.abv.toFixed(1)}%` : null,
                        kegType ? KEG_TYPE_LABELS[kegType] : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                    <span className="taps-row__status font-tabular" data-testid="taps-row-status">
                      {isKicked
                        ? 'Kicked'
                        : tap.beer && tap.keg
                          ? `${formatWholeVolume(tap.keg.remainingMl, units)} left · ≈ ${Math.round(tap.keg.remainingMl / ML_PER_PINT)} pints · ${Math.round(levelPct)}%`
                          : '—'}
                    </span>
                    {stat && kickDaysLabel(stat) && (
                      <span
                        className={kickSoon ? 'taps-row__forecast taps-row__forecast--danger' : 'taps-row__forecast'}
                        data-testid="taps-row-forecast"
                      >
                        {kickDaysLabel(stat)}
                      </span>
                    )}
                    {(() => {
                      // Days-to-kick timeline: a green→amber→red gradient bar with a marker at
                      // the elapsed/predicted position (tapped date → projected kick).
                      const timelinePct = stat && tap.keg
                        ? kickTimelinePct(tap.keg.dateTapped, stat.projectedKickDate)
                        : null;
                      return timelinePct != null ? (
                        <span className="taps-row__timeline" data-testid="taps-row-timeline" aria-hidden="true">
                          <span className="taps-row__timeline-marker" style={{ left: `${timelinePct}%` }} />
                        </span>
                      ) : null;
                    })()}
                  </span>
                  <span className="taps-row__actions">
                    <button
                      type="button"
                      data-testid="taps-row-expand"
                      onClick={() => setExpandedTapId(expanded ? null : tap.tapId)}
                    >
                      {expanded ? 'Hide details' : 'Details'}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className={kickSoon ? 'taps-row__swap taps-row__swap--critical' : 'taps-row__swap'}
                        data-testid="taps-row-swap"
                        onClick={() => setWizardState({ tap, promoteKeg: null })}
                      >
                        {hasActiveKeg ? 'Swap keg' : 'Tap keg'}
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        data-testid="taps-row-edit"
                        onClick={() => setTapFormState({ mode: 'edit', tap: tapToPlainTap(tap, tapRows) })}
                      >
                        Edit
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        data-testid="taps-row-delete"
                        onClick={() => setDeleteState({ tap: tapToPlainTap(tap, tapRows), error: null })}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </div>

                {expanded && (
                  <div className="taps-row__details" data-testid="taps-row-details">
                    {(() => {
                      const cleaning = cleanings.find((c) => c.tapId === tap.tapId);
                      return (
                        <div
                          className={cleaning?.due ? 'taps-cleaning taps-cleaning--due' : 'taps-cleaning'}
                          data-testid="taps-cleaning"
                          data-due={cleaning?.due ?? false}
                        >
                          <div className="taps-cleaning__head">
                            <span className="taps-cleaning__label">LINE CLEANING</span>
                            <span className="taps-cleaning__status font-tabular">
                              {cleaning?.ignored ? 'Reminders ignored' : cleaning?.inactive ? 'Empty tap · reminders paused' : cleaning?.lastCleanedAt
                                ? `${cleaning.daysSince} day(s) · ${cleaning.gallonsSince} gal since`
                                : 'No cleaning recorded'}
                              {cleaning?.due ? ' · due now' : ''}
                            </span>
                            {canEdit && (
                              <div className="taps-cleaning__actions">
                                <button
                                  type="button"
                                  className="taps-cleaning__log"
                                  data-testid="taps-cleaning-log"
                                  onClick={() => setCleaningDialog({ tapId: tap.tapId, when: '' })}
                                >
                                  Log cleaning
                                </button>
                                <button
                                  type="button"
                                  className="taps-cleaning__log"
                                  disabled={reminderSaving !== null || !cleaning}
                                  onClick={() => handleReminders(tap.tapId, !cleaning?.ignored)}
                                >
                                  {reminderSaving === tap.tapId ? 'Saving…' : cleaning?.ignored ? 'Resume reminders' : 'Ignore reminders'}
                                </button>
                              </div>
                            )}
                          </div>
                          {cleaning && !cleaning.ignored && !cleaning.inactive && (
                            <span className="taps-cleaning__meter" data-testid="taps-cleaning-meter" aria-hidden="true">
                              <span
                                className="taps-cleaning__meter-fill"
                                data-due={cleaning.due}
                                style={{ width: `${Math.round(cleaningProgress(cleaning) * 100)}%` }}
                              />
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <OnDeckQueue
                      tapId={tap.tapId}
                      beers={beers}
                      kegs={kegs}
                      units={units}
                      canEdit={canEdit}
                      refreshKey={dataRefreshKey}
                      critical={kickSoon}
                      onPromote={(queuedKeg) => setWizardState({ tap, promoteKeg: queuedKeg })}
                    />
                    <KickedHistory
                      tapId={tap.tapId}
                      beers={beers}
                      units={units}
                      refreshKey={dataRefreshKey}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deleteState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="taps-delete-confirm"
          onClick={() => !deleting && setDeleteState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="taps-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="taps-delete-title" className="font-display">Delete tap</h3>
            <p>
              This will permanently delete tap {deleteState.tap.number}
              {deleteState.tap.name ? ` (${deleteState.tap.name})` : ''} from the taproom. This can&rsquo;t
              be undone.
            </p>
            {deleteState.error && (
              <p role="alert" data-testid="taps-delete-error">{deleteState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="taps-delete-confirm-button"
                disabled={deleting}
                onClick={handleConfirmDeleteTap}
              >
                {deleting ? 'Deleting…' : 'Delete tap'}
              </button>
              <button
                type="button"
                data-testid="taps-delete-cancel-button"
                disabled={deleting}
                onClick={() => setDeleteState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {wizardState && (
        <SwapWizard
          tap={wizardState.tap}
          beers={beers}
          kegs={kegs}
          monitors={monitors}
          promoteKeg={wizardState.promoteKeg}
          onClose={() => setWizardState(null)}
          onDone={refresh}
        />
      )}

      {cleaningError && !cleaningDialog && <p role="alert">{cleaningError}</p>}
      {cleaningDialog && (
        <div className="admin-confirm__backdrop" data-testid="cleaning-dialog" onClick={() => !cleaningSaving && setCleaningDialog(null)}>
          <div className="admin-confirm" role="dialog" aria-modal="true" aria-label="Log line cleaning" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display">Log line cleaning</h3>
            {cleaningError && <p role="alert">{cleaningError}</p>}
            <p className="admin-page-quiet">Backdating recomputes the counters — pours after the chosen date count toward the next cleaning.</p>
            <div className="cleaning-dialog__picks">
              <button
                type="button"
                data-testid="cleaning-pick-now"
                aria-pressed={cleaningDialog.when === ''}
                onClick={() => setCleaningDialog({ ...cleaningDialog, when: '' })}
              >
                Just now
              </button>
              <button
                type="button"
                data-testid="cleaning-pick-yesterday"
                aria-pressed={cleaningDialog.when === daysAgoDate(1)}
                onClick={() => setCleaningDialog({ ...cleaningDialog, when: daysAgoDate(1) })}
              >
                Yesterday
              </button>
              <input
                type="date"
                data-testid="cleaning-pick-date"
                max={daysAgoDate(0)}
                value={cleaningDialog.when}
                onChange={(e) => setCleaningDialog({ ...cleaningDialog, when: e.target.value })}
              />
            </div>
            <p className="cleaning-dialog__preview" data-testid="cleaning-dialog-preview">
              {cleaningDialog.when
                ? `Will log as cleaned on ${new Date(`${cleaningDialog.when}T12:00:00`).toLocaleDateString()}.`
                : 'Will log as cleaned just now.'}
            </p>
            <div className="admin-confirm__actions">
              <button type="button" data-testid="cleaning-dialog-save" disabled={cleaningSaving} onClick={handleLogCleaning}>
                {cleaningSaving ? 'Saving…' : 'Log cleaning'}
              </button>
              <button type="button" data-testid="cleaning-dialog-cancel" disabled={cleaningSaving} onClick={() => setCleaningDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
