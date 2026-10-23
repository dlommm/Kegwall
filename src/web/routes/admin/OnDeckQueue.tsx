import { useCallback, useEffect, useState } from 'react';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import { listOnDeck, createKeg, removeOnDeckKeg } from '../../lib/adminApi';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';
import { Button, ConfirmDialog } from './ui';
import { BeerPicker } from './BeerPicker';
import { KEG_TYPE_OPTIONS, type KegTypeSelectValue } from '../../lib/kegTypeOptions';

interface OnDeckQueueProps {
  tapId: number;
  beers: Beer[];
  /** Every keg on record — threaded straight through to `BeerPicker`'s size default
   * lookup (see SwapWizard's identical use) when adding a new queue entry. */
  kegs: Keg[];
  units: VolumeUnits;
  canEdit: boolean;
  /** Bumped by the parent whenever something outside this component (a promote, a swap)
   * may have changed this tap's queue — triggers a refetch. */
  refreshKey: number;
  onPromote: (queuedKeg: Keg) => void;
  /** The tap's current keg is about to kick — the promote action becomes the accent
   *  primary "Swap now →" so staff can pull the queued keg forward immediately (redesign 3d). */
  critical?: boolean;
}

function beerName(beers: Beer[], beerId: number): string {
  return beers.find((b) => b.id === beerId)?.name ?? 'Unknown beer';
}

/** The swap wizard's on-deck queue for a single tap (Task 5): list what's queued, add a
 * new entry (reusing `BeerPicker`), remove one, or promote it straight to on_tap (handed
 * off to the parent, which opens `SwapWizard` with `promoteKeg` set). */
export function OnDeckQueue({
  tapId, beers, kegs, units, canEdit, refreshKey, onPromote, critical = false,
}: OnDeckQueueProps) {
  const [queue, setQueue] = useState<Keg[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [adding, setAdding] = useState(false);
  const [pickedBeer, setPickedBeer] = useState<Beer | null>(null);
  const [sizeMl, setSizeMl] = useState('');
  const [volStartMl, setVolStartMl] = useState('');
  const [kegTypeSelect, setKegTypeSelect] = useState<KegTypeSelectValue>('auto');
  const [addError, setAddError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Keg | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    setStatus('loading');
    listOnDeck(tapId).then((result) => {
      if (result.ok) {
        setQueue(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, [tapId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  function resetAddForm() {
    setAdding(false);
    setPickedBeer(null);
    setSizeMl('');
    setVolStartMl('');
    setKegTypeSelect('auto');
    setAddError(null);
  }

  function handlePick(beer: Beer) {
    setPickedBeer(beer);
    const last = kegs.find((k) => k.beerId === beer.id);
    setSizeMl(last ? String(last.sizeMl) : '');
    setVolStartMl(last ? String(last.volStartMl) : '');
    setKegTypeSelect('auto');
  }

  async function handleAddSubmit() {
    if (!pickedBeer) return;
    setAddError(null);
    const size = Number(sizeMl.trim());
    const start = Number(volStartMl.trim());
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(start) || start <= 0) {
      setAddError('Size and starting volume must both be positive numbers.');
      return;
    }
    setSubmitting(true);
    // 'auto' (the default) is never sent to the server -- omitting `kegType` entirely
    // means "auto-match by sizeMl" server-side too (see kegs.ts's `createKeg`).
    const result = await createKeg({
      beerId: pickedBeer.id, sizeMl: size, volStartMl: start, tapId, status: 'on_deck',
      ...(kegTypeSelect !== 'auto' ? { kegType: kegTypeSelect } : {}),
    });
    setSubmitting(false);
    if (result.ok) {
      resetAddForm();
      load();
      return;
    }
    setAddError(result.message);
  }

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    const result = await removeOnDeckKeg(removeTarget.id);
    setRemoving(false);
    if (result.ok) {
      setRemoveTarget(null);
      setRemoveError(null);
      load();
      return;
    }
    setRemoveError(result.message);
  }

  return (
    <div className="on-deck-queue" data-testid="on-deck-queue">
      <h3 className="on-deck-queue__title">On deck</h3>

      {status === 'loading' && <p className="admin-page-quiet" data-testid="on-deck-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="on-deck-error">
          Couldn&rsquo;t load the queue. Try again.
        </p>
      )}
      {status === 'loaded' && queue.length === 0 && (
        <p className="admin-page-quiet" data-testid="on-deck-empty">Nothing queued.</p>
      )}
      {status === 'loaded' && queue.length > 0 && (
        <ul className="on-deck-queue__list" data-testid="on-deck-list">
          {queue.map((keg) => (
            <li key={keg.id} className="on-deck-queue__row" data-testid="on-deck-row">
              <span className="on-deck-queue__beer" data-testid="on-deck-row-beer">
                {beerName(beers, keg.beerId)}
              </span>
              <span className="font-tabular">{formatVolumeMl(keg.sizeMl, units)}</span>
              {canEdit && (
                <span className="on-deck-queue__row-actions">
                  <Button
                    variant={critical ? 'primary' : 'secondary'}
                    className={critical ? 'on-deck-queue__promote--now' : undefined}
                    data-testid="on-deck-row-promote"
                    data-critical={critical}
                    onClick={() => onPromote(keg)}
                  >
                    {critical ? 'Swap now' : 'Tap next'}
                  </Button>
                  <Button
                    variant="quiet"
                    data-testid="on-deck-row-remove"
                    onClick={() => { setRemoveTarget(keg); setRemoveError(null); }}
                  >
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !adding && (
        <Button data-testid="on-deck-add-toggle" onClick={() => setAdding(true)}>
          Add to queue
        </Button>
      )}

      {canEdit && adding && (
        <div className="on-deck-queue__add-form" data-testid="on-deck-add-form">
          {!pickedBeer ? (
            <BeerPicker beers={beers} allowCreate onPick={handlePick} />
          ) : (
            <>
              <p className="adm-name">{pickedBeer.name}</p>
              <div className="adm-grid-2">
                <label className="admin-field">
                  <span>Size (mL)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    data-testid="on-deck-add-size"
                    value={sizeMl}
                    onChange={(e) => setSizeMl(e.target.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Starting volume (mL)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    data-testid="on-deck-add-volstart"
                    value={volStartMl}
                    onChange={(e) => setVolStartMl(e.target.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Keg type</span>
                  <select
                    data-testid="on-deck-add-keg-type"
                    value={kegTypeSelect}
                    onChange={(e) => setKegTypeSelect(e.target.value as KegTypeSelectValue)}
                  >
                    {KEG_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} data-testid="on-deck-add-keg-type-option">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {addError && (
                <p className="adm-danger-text" role="alert" data-testid="on-deck-add-error">{addError}</p>
              )}
              <div className="swap-wizard__actions">
                <Button
                  variant="primary"
                  data-testid="on-deck-add-submit"
                  disabled={submitting}
                  onClick={handleAddSubmit}
                >
                  {submitting ? 'Adding…' : 'Add to queue'}
                </Button>
                <Button variant="quiet" data-testid="on-deck-add-cancel" onClick={resetAddForm} disabled={submitting}>
                  Cancel
                </Button>
              </div>
            </>
          )}
          {!pickedBeer && (
            <Button variant="quiet" data-testid="on-deck-add-cancel" onClick={resetAddForm}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => { if (!open) { setRemoveTarget(null); setRemoveError(null); } }}
        title="Remove from the queue?"
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={removing}
        error={removeError}
        onConfirm={handleConfirmRemove}
        testId="on-deck-remove-confirm"
        confirmTestId="on-deck-remove-confirm-button"
        cancelTestId="on-deck-remove-cancel-button"
        errorTestId="on-deck-remove-error"
      >
        {removeTarget && (
          <p>
            This will permanently remove &ldquo;{beerName(beers, removeTarget.beerId)}&rdquo; from the on-deck
            queue. This can&rsquo;t be undone.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
