import { useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import {
  swapTap, resetKegtronVolume, listSuppliers,
  type MonitorWithDeviceKeg, type Supplier,
} from '../../lib/adminApi';
import { BeerPicker } from './BeerPicker';
import { tapLabel } from './monitors/monitorText';
import { ML_PER_PINT } from '../../../server/core/pricing.js';
import { Button, Drawer } from './ui';
import { beerMarkerModel } from '../../wall/wallModel';
import { TapMarker } from '../../wall/TapMarker';
import { KEG_TYPE_OPTIONS, type KegTypeSelectValue } from '../../lib/kegTypeOptions';


interface SwapWizardProps {
  tap: TapState;
  beers: Beer[];
  /** Every keg on record (any status/tap) — used only to default the size/volume step
   * from the picked beer's most recent keg (see `lastKegDefaults` below). */
  kegs: Keg[];
  /** Sanitized monitor list (no device key) — used to find a Kegtron Pro monitor bound
   * to this tap, which unlocks the "Import from Kegtron" pick option, the size step's
   * device prefill (`deviceKeg`), and the final "Reset volume on device" step. */
  monitors: MonitorWithDeviceKeg[];
  /** Set when opened from the on-deck queue's "Promote" action: skips the beer/size
   * steps entirely (the queued keg already has both) and swaps via `fromKegId`. */
  promoteKeg?: Keg | null;
  onClose: () => void;
  /** Called once the swap itself has succeeded (before any optional Kegtron reset). */
  onDone: () => void;
}

type Step = 'confirm' | 'pick' | 'size' | 'cost' | 'reset';

/** Prefills size/volume from the picked beer's most recently created keg, of any status
 * or tap — `kegs` (from `GET /api/kegs`, no status filter) is already sorted newest-first
 * by the server, so the first match is the most recent. Blank strings (no prior keg for
 * this beer) leave the fields for the operator to fill in by hand. */
function lastKegDefaults(beerId: number, kegs: Keg[]): { sizeMl: string; volStartMl: string } {
  const last = kegs.find((k) => k.beerId === beerId);
  return last
    ? { sizeMl: String(last.sizeMl), volStartMl: String(last.volStartMl) }
    : { sizeMl: '', volStartMl: '' };
}

const ML_PER_GAL = 3785.411784;

/** "≈ 7.75 gal" readout under an mL input (Kegtron devices are metric-native, so the
 * canonical fields stay mL), or null while the field isn't a positive number. */
function galHint(ml: string): string | null {
  const n = Number(ml.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return `≈ ${(n / ML_PER_GAL).toFixed(2)} gal`;
}

/**
 * The keg swap wizard (Task 5): confirm kicking whatever's currently on tap, pick (or
 * create/import) the next beer, set size/starting volume, then optionally reset a bound
 * Kegtron Pro device's on-board volume counter. Also handles the on-deck "promote" path
 * (`promoteKeg` set) — same confirm + optional reset, but no beer/size steps since a
 * queued keg already carries both.
 */
export function SwapWizard({
  tap, beers, kegs, monitors, promoteKeg: promoteKegProp = null, onClose, onDone,
}: SwapWizardProps) {
  // Choosing the tap's next-up keg on the pick step turns a plain swap into a promote.
  const [promoteKeg, setPromoteKeg] = useState<Keg | null>(promoteKegProp);
  const hasActiveKeg = tap.keg != null && tap.keg.status === 'on_tap';
  const boundMonitor = monitors.find((m) => m.tapId === tap.tapId && m.type === 'kegtron_pro') ?? null;

  const steps: Step[] = [
    ...(hasActiveKeg || promoteKeg ? (['confirm'] as const) : []),
    ...(promoteKeg ? [] : (['pick', 'size', 'cost'] as const)),
    ...(boundMonitor ? (['reset'] as const) : []),
  ];

  const [stepIndex, setStepIndex] = useState(0);
  const [pickedBeer, setPickedBeer] = useState<Beer | null>(null);
  const [sizeMl, setSizeMl] = useState('');
  const [volStartMl, setVolStartMl] = useState('');
  const [prefilledFromDevice, setPrefilledFromDevice] = useState(false);
  const [kegTypeSelect, setKegTypeSelect] = useState<KegTypeSelectValue>('auto');
  const [sizeError, setSizeError] = useState<string | null>(null);
  // Cost step (redesign 4k) — dollars in the UI, cents to the API. All optional/skippable.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [costDollars, setCostDollars] = useState('');
  const [depositDollars, setDepositDollars] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [purchasedAt, setPurchasedAt] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<'idle' | 'done' | 'error'>('idle');
  const [resetError, setResetError] = useState<string | null>(null);

  const step = steps[stepIndex];
  const canGoBack = stepIndex > 0 && step !== 'reset';

  // Suppliers for the cost step's dropdown (redesign 4l) — editor-readable list.
  useEffect(() => {
    if (promoteKegProp) return; // promoting keeps the queued keg's own cost; no cost step
    listSuppliers().then((result) => {
      if (result.ok) setSuppliers(result.data);
    });
  }, [promoteKegProp]);

  async function doSwap(
    input:
      | { beerId: number; sizeMl: number; volStartMl: number; kegType?: Exclude<KegTypeSelectValue, 'auto'> }
      | { fromKegId: number },
  ) {
    setSwapError(null);
    setSwapping(true);
    const result = await swapTap(tap.tapId, input);
    setSwapping(false);
    if (!result.ok) {
      setSwapError(result.message);
      return;
    }
    onDone();
    const resetIndex = steps.indexOf('reset');
    if (resetIndex === -1) {
      onClose();
    } else {
      setStepIndex(resetIndex);
    }
  }

  function handleConfirm() {
    if (promoteKeg) {
      void doSwap({ fromKegId: promoteKeg.id });
      return;
    }
    setStepIndex(stepIndex + 1);
  }

  function handlePick(beer: Beer) {
    setPickedBeer(beer);
    // Prefill precedence: what the bound Kegtron device itself reports (the operator
    // already typed size/starting volume into Kegtron's app) beats this beer's last keg
    // on record beats empty. Per-field, since a device can report a start volume with
    // no size (or a zero start before its new keg is configured).
    const device = boundMonitor?.deviceKeg ?? null;
    const defaults = lastKegDefaults(beer.id, kegs);
    const deviceSize = device?.sizeMl != null && device.sizeMl > 0 ? String(device.sizeMl) : null;
    const deviceStart = device != null && device.volStartMl > 0 ? String(device.volStartMl) : null;
    setSizeMl(deviceSize ?? defaults.sizeMl);
    setVolStartMl(deviceStart ?? defaults.volStartMl);
    setPrefilledFromDevice(deviceSize !== null || deviceStart !== null);
    setKegTypeSelect('auto');
    setStepIndex(stepIndex + 1);
  }

  function handleSizeSubmit() {
    setSizeError(null);
    const size = Number(sizeMl.trim());
    const start = Number(volStartMl.trim());
    if (!Number.isFinite(size) || size <= 0) {
      setSizeError('Size must be a positive number.');
      return;
    }
    if (!Number.isFinite(start) || start <= 0) {
      setSizeError('Starting volume must be a positive number.');
      return;
    }
    if (start > size) {
      setSizeError("Starting volume can't be more than the keg's size.");
      return;
    }
    if (!pickedBeer) return;
    // Size is valid — advance to the (skippable) cost step; the swap fires from there.
    setStepIndex(stepIndex + 1);
  }

  /** Parse a "$12.34" dollar string to integer cents, or null when blank/invalid. */
  function dollarsToCents(v: string): number | null {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  }

  function handleCostSubmit(skip: boolean) {
    if (!pickedBeer) return;
    const size = Number(sizeMl.trim());
    const start = Number(volStartMl.trim());
    // 'auto' (the default) is never sent to the server — omitting `kegType` entirely means
    // "auto-match by sizeMl" server-side too (see kegs.ts's `createKeg`/`swapKeg`).
    void doSwap({
      beerId: pickedBeer.id,
      sizeMl: size,
      volStartMl: start,
      ...(kegTypeSelect !== 'auto' ? { kegType: kegTypeSelect } : {}),
      ...(skip ? {} : {
        costCents: dollarsToCents(costDollars),
        depositCents: dollarsToCents(depositDollars),
        supplierId: supplierId ? Number(supplierId) : null,
        purchasedAt: purchasedAt || null,
      }),
    });
  }

  async function handleResetVolume() {
    if (!boundMonitor) return;
    setResetError(null);
    setResetting(true);
    const result = await resetKegtronVolume(boundMonitor.id);
    setResetting(false);
    if (result.ok) {
      setResetResult('done');
      return;
    }
    setResetResult('error');
    setResetError(result.status === 502
      ? "Couldn't reach the Kegtron device. You can try again or finish without resetting."
      : result.message);
  }

  const promoteBeerName = promoteKeg ? beers.find((b) => b.id === promoteKeg.beerId)?.name ?? 'the queued keg' : null;
  const currentBeerName = tap.beer?.name ?? 'the current keg';
  // The pick step's quick choices (prototypes/admin-taps.html): the tap's next on-deck keg,
  // and another keg of the beer that's on now.
  const nextUp = promoteKeg ? null : kegs
    .filter((k) => k.tapId === tap.tapId && k.status === 'on_deck')
    .sort((a, b) => a.id - b.id)[0] ?? null;
  const nextUpBeer = nextUp ? beers.find((b) => b.id === nextUp.beerId) ?? null : null;
  const sameBeer = tap.beer ? beers.find((b) => b.id === tap.beer!.id) ?? null : null;
  const stepLabels: Record<Step, string> = {
    confirm: hasActiveKeg ? 'Kick the old keg' : 'Confirm',
    pick: 'Choose the beer',
    size: 'Keg size',
    cost: 'Cost',
    reset: 'Reset the counter',
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => { if (!open && !swapping) onClose(); }}
      size="wide"
      testId="swap-wizard"
      title={promoteKeg ? `Tap the next keg on ${tapLabel(tap)}` : `Swap the keg on ${tapLabel(tap)}`}
      description={hasActiveKeg
        ? `${currentBeerName} is on now. The old keg is marked kicked and its pours stay in history.`
        : `${tapLabel(tap)} has no keg on.`}
    >
      <ol className="adm-steps" aria-label="Steps">
        {steps.map((st, i) => (
          <li key={st} aria-current={i === stepIndex ? 'step' : undefined} data-done={i < stepIndex || undefined}>
            <span>{`Step ${i + 1} of ${steps.length} · ${stepLabels[st]}`}</span>
          </li>
        ))}
      </ol>

      {step === 'confirm' && (
        <div className="swap-wizard__step" data-testid="swap-wizard-step-confirm">
          {hasActiveKeg && promoteKeg ? (
            <p>
              This will kick {currentBeerName} and tap {promoteBeerName} from the on-deck queue
              onto {tapLabel(tap)}. The kicked keg moves to history and this can&rsquo;t be undone.
            </p>
          ) : hasActiveKeg ? (
            <p>
              This will kick {tapLabel(tap)}&rsquo;s current keg, {currentBeerName}. It moves to
              kicked history and this can&rsquo;t be undone.
            </p>
          ) : (
            <p>
              This will tap {promoteBeerName} from the on-deck queue onto {tapLabel(tap)}.
            </p>
          )}
          {swapError && (
            <p className="adm-danger-text" role="alert" data-testid="swap-wizard-swap-error">{swapError}</p>
          )}
          <div className="swap-wizard__actions">
            <Button
              variant={hasActiveKeg ? 'danger' : 'primary'}
              data-testid="swap-wizard-kick-button"
              disabled={swapping}
              onClick={handleConfirm}
            >
              {swapping ? 'Working…' : hasActiveKeg ? 'Kick keg' : 'Tap this keg'}
            </Button>
            {promoteKeg && !promoteKegProp && (
              <Button onClick={() => { setPromoteKeg(null); setStepIndex(hasActiveKeg ? 1 : 0); }}>Back</Button>
            )}
            <Button variant="quiet" data-testid="swap-wizard-cancel" onClick={onClose} disabled={swapping}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'pick' && (
        <div className="swap-wizard__step" data-testid="swap-wizard-step-pick">
          {(nextUpBeer || sameBeer) && (
            <div className="swap-wizard__options">
              {nextUp && nextUpBeer && (
                <button
                  type="button"
                  className="adm-option"
                  data-testid="swap-wizard-next-up"
                  onClick={() => { setPromoteKeg(nextUp); setStepIndex(0); }}
                >
                  <BeerSwatch beer={nextUpBeer} />
                  <span>
                    <b className="adm-name">{nextUpBeer.name}</b>
                    <span className="adm-sub" style={{ display: 'block' }}>On deck for this tap</span>
                  </span>
                  <span className="adm-sub">Next up</span>
                </button>
              )}
              {sameBeer && (
                <button
                  type="button"
                  className="adm-option"
                  data-testid="swap-wizard-same-beer"
                  onClick={() => handlePick(sameBeer)}
                >
                  <BeerSwatch beer={sameBeer} />
                  <span>
                    <b className="adm-name">{sameBeer.name}</b>
                    <span className="adm-sub" style={{ display: 'block' }}>Another keg of the same beer</span>
                  </span>
                  <span />
                </button>
              )}
              <h3 className="swap-wizard__or">Or a different beer</h3>
            </div>
          )}
          <BeerPicker
            beers={beers}
            allowCreate
            kegtronMonitorId={boundMonitor?.id ?? null}
            onPick={handlePick}
          />
          <div className="swap-wizard__actions">
            {canGoBack && (
              <Button data-testid="swap-wizard-back" onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </Button>
            )}
            <Button variant="quiet" data-testid="swap-wizard-cancel" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'size' && pickedBeer && (
        <div className="swap-wizard__step" data-testid="swap-wizard-step-size">
          <p className="adm-name">{pickedBeer.name}</p>
          <div className="adm-grid-2">
            <label className="admin-field">
              <span>Size (mL)</span>
              <input
                type="text"
                inputMode="numeric"
                data-testid="swap-wizard-size"
                value={sizeMl}
                onChange={(e) => setSizeMl(e.target.value)}
              />
              {galHint(sizeMl) && (
                <span className="admin-field__unit-hint" data-testid="swap-wizard-size-gal">
                  {galHint(sizeMl)}
                </span>
              )}
            </label>
            <label className="admin-field">
              <span>Starts at (mL)</span>
              <input
                type="text"
                inputMode="numeric"
                data-testid="swap-wizard-volstart"
                value={volStartMl}
                onChange={(e) => setVolStartMl(e.target.value)}
              />
              {galHint(volStartMl) && (
                <span className="admin-field__unit-hint" data-testid="swap-wizard-volstart-gal">
                  {galHint(volStartMl)}
                </span>
              )}
              <span className="admin-field__unit-hint">Lower it for a partly used keg.</span>
            </label>
            <label className="admin-field">
              <span>Keg type</span>
              <select
                data-testid="swap-wizard-keg-type"
                value={kegTypeSelect}
                onChange={(e) => setKegTypeSelect(e.target.value as KegTypeSelectValue)}
              >
                {KEG_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} data-testid="swap-wizard-keg-type-option">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {prefilledFromDevice && (
            <p className="adm-sub" data-testid="swap-wizard-device-prefill-note">
              Prefilled from the Kegtron device&rsquo;s own keg setup. Adjust it if the
              device hasn&rsquo;t been updated for the new keg yet.
            </p>
          )}
          {sizeError && (
            <p className="adm-danger-text" role="alert" data-testid="swap-wizard-size-error">{sizeError}</p>
          )}
          {swapError && (
            <p className="adm-danger-text" role="alert" data-testid="swap-wizard-swap-error">{swapError}</p>
          )}
          <div className="swap-wizard__actions">
            <Button
              variant="primary"
              data-testid="swap-wizard-submit"
              disabled={swapping}
              onClick={handleSizeSubmit}
            >
              Next: keg cost
            </Button>
            {canGoBack && (
              <Button data-testid="swap-wizard-back" onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </Button>
            )}
            <Button variant="quiet" data-testid="swap-wizard-cancel" onClick={onClose} disabled={swapping}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'cost' && pickedBeer && (
        <div className="swap-wizard__step" data-testid="swap-wizard-step-cost">
          <p>What did this keg cost? This is optional.</p>
          <div className="adm-grid-2">
            <label className="admin-field">
              <span>Keg cost ($)</span>
              <input
                type="text"
                inputMode="decimal"
                data-testid="swap-wizard-cost"
                placeholder="e.g. 131.00"
                value={costDollars}
                onChange={(e) => setCostDollars(e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Deposit ($)</span>
              <input
                type="text"
                inputMode="decimal"
                data-testid="swap-wizard-deposit"
                value={depositDollars}
                onChange={(e) => setDepositDollars(e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Supplier</span>
              <select
                data-testid="swap-wizard-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Purchase date</span>
              <input
                type="date"
                data-testid="swap-wizard-purchased"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
              />
            </label>
          </div>
          {(() => {
            const cents = dollarsToCents(costDollars);
            // Per pint of what's actually in the keg, the same basis as the Kegs page and the
            // analytics KPI (a partly used keg costs more per pint than its size suggests).
            const start = Number(volStartMl.trim());
            const pints = start > 0 ? start / ML_PER_PINT : 0;
            return cents != null && pints > 0 ? (
              <p className="adm-num-cell" data-testid="swap-wizard-cost-preview">
                {`≈ $${(cents / 100 / pints).toFixed(2)} / pint owner cost`}
              </p>
            ) : null;
          })()}
          <p className="adm-sub" data-testid="swap-wizard-cost-lock">
            Only owners see costs. They never appear on the wall, menu, tablet or board.
          </p>
          {swapError && (
            <p className="adm-danger-text" role="alert" data-testid="swap-wizard-swap-error">{swapError}</p>
          )}
          <div className="swap-wizard__actions">
            <Button
              variant="primary"
              data-testid="swap-wizard-cost-submit"
              disabled={swapping}
              onClick={() => handleCostSubmit(false)}
            >
              {swapping ? 'Tapping…' : `Tap ${pickedBeer.name}`}
            </Button>
            <Button
              data-testid="swap-wizard-cost-skip"
              disabled={swapping}
              onClick={() => handleCostSubmit(true)}
            >
              Skip
            </Button>
            <Button variant="quiet" data-testid="swap-wizard-back" onClick={() => setStepIndex(stepIndex - 1)} disabled={swapping}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'reset' && (
        <div className="swap-wizard__step" data-testid="swap-wizard-step-reset">
          <p>{tapLabel(tap)} is now on tap.</p>
          <p>
            This tap&rsquo;s monitor is a Kegtron Pro. You can reset its counter to zero to match
            the new keg. This changes the real device&rsquo;s counter.
          </p>
          {resetResult === 'done' && (
            <p className="adm-ok-text" data-testid="swap-wizard-reset-done">Volume reset on the device.</p>
          )}
          {resetResult === 'error' && (
            <p className="adm-danger-text" role="alert" data-testid="swap-wizard-reset-error">{resetError}</p>
          )}
          <div className="swap-wizard__actions">
            {resetResult !== 'done' && (
              <Button
                data-testid="swap-wizard-reset-button"
                disabled={resetting}
                onClick={handleResetVolume}
              >
                {resetting ? 'Resetting…' : 'Reset volume on device'}
              </Button>
            )}
            <Button variant="primary" data-testid="swap-wizard-finish" onClick={onClose}>
              Finish
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** A beer's marker for the swap choices (no tap number: it isn't on one yet). */
function BeerSwatch({ beer }: { beer: Beer }) {
  return <TapMarker model={beerMarkerModel(beer)} size={52} showNumber={false} />;
}
