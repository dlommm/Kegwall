import { useCallback, useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Tap } from '../../../server/db/taps.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import type { Monitor } from '../../../server/db/monitors.js';
import type { Role } from '../../../server/db/users.js';
import {
  getMe, listBeers, listKegs, listMonitors, deleteTap as deleteTapApi,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import type { VolumeUnits } from '../../lib/units';
import { srmToColor } from '../../lib/srm';
import { TapForm } from './TapForm';
import { SwapWizard } from './SwapWizard';
import { OnDeckQueue } from './OnDeckQueue';
import { KickedHistory } from './KickedHistory';

type TapFormState = { mode: 'create' } | { mode: 'edit'; tap: Tap } | null;
interface DeleteTapState { tap: Tap; error: string | null }
interface WizardState { tap: TapState; promoteKeg: Keg | null }

function tapToPlainTap(tap: TapState): Tap {
  return { id: tap.tapId, number: tap.tapNumber, name: tap.tapName };
}

/** A tap's level pill fill color: the beer's real SRM tint, or a muted neutral once
 * kicked — matches DashboardPage's identical treatment (the one other place the liquid/
 * SRM language reappears in the admin UI, per the design direction). */
function pillColor(isKicked: boolean, srm: number | null): string {
  if (isKicked) return 'color-mix(in srgb, var(--text) 30%, transparent)';
  return srmToColor(srm).liquid;
}

/**
 * `/admin/taps` (Task 5): the taps list (with a live level pill fed by the same `/ws`
 * snapshot the wall uses), tap CRUD, the keg swap wizard, and — per tap, behind an
 * expand toggle — the on-deck queue and kicked history. A viewer sees the list and the
 * expandable detail panels read-only: no Add/Edit/Delete/Swap controls, and the on-deck
 * queue's add/remove/promote controls are hidden the same way `canEdit` gates BeersPage.
 */
export function TapsPage() {
  const [role, setRole] = useState<Role | null>(null);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [tapsStatus, setTapsStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [expandedTapId, setExpandedTapId] = useState<number | null>(null);
  const [tapFormState, setTapFormState] = useState<TapFormState>(null);
  const [deleteState, setDeleteState] = useState<DeleteTapState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMe().then((result) => {
      if (!cancelled && result.ok) setRole(result.data.role);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setInitialTaps(result.data.taps);
        setUnits(result.data.units ?? 'us');
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

  // Beers/kegs/monitors don't ride the /ws snapshot (only tap-level state does) — this
  // reloads all three whenever `dataRefreshKey` is bumped (after a swap, a tap edit, or
  // any other action that could have changed what the swap wizard/on-deck queue need).
  const loadCatalogData = useCallback(() => {
    listBeers().then((result) => { if (result.ok) setBeers(result.data); });
    listKegs().then((result) => { if (result.ok) setKegs(result.data); });
    listMonitors().then((result) => { if (result.ok) setMonitors(result.data); });
  }, []);

  useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData, dataRefreshKey]);

  const refresh = useCallback(() => setDataRefreshKey((k) => k + 1), []);

  const canEdit = role === 'editor' || role === 'admin';

  function handleTapSaved() {
    setTapFormState(null);
    refresh();
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
            return (
              <li key={tap.tapId} className="taps-row" data-testid="taps-row" data-kicked={isKicked}>
                <div className="taps-row__main">
                  <span className="taps-row__number font-tabular">{tap.tapNumber}</span>
                  <span className="taps-row__name">{tap.tapName ?? '—'}</span>
                  <span className="taps-row__bar" aria-hidden="true">
                    <span
                      className="taps-row__fill"
                      style={{
                        width: `${Math.round(levelPct)}%`,
                        backgroundColor: pillColor(isKicked, tap.beer?.srm ?? null),
                      }}
                    />
                  </span>
                  <span className="taps-row__beer">
                    {tap.beer ? tap.beer.name : 'Empty'}
                  </span>
                  <span className="taps-row__status font-tabular" data-testid="taps-row-status">
                    {isKicked ? 'Kicked' : tap.beer ? `${Math.round(levelPct)}%` : '—'}
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
                        onClick={() => setTapFormState({ mode: 'edit', tap: tapToPlainTap(tap) })}
                      >
                        Edit
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        data-testid="taps-row-delete"
                        onClick={() => setDeleteState({ tap: tapToPlainTap(tap), error: null })}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </div>

                {expanded && (
                  <div className="taps-row__details" data-testid="taps-row-details">
                    <OnDeckQueue
                      tapId={tap.tapId}
                      beers={beers}
                      kegs={kegs}
                      units={units}
                      canEdit={canEdit}
                      refreshKey={dataRefreshKey}
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
    </section>
  );
}
