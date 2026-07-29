import { useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Beer } from '../../../server/db/beers.js';
import type { Keg } from '../../../server/db/kegs.js';
import type { Monitor } from '../../../server/db/monitors.js';
import { swapTap, resetKegtronVolume } from '../../lib/adminApi';
import { BeerPicker } from './BeerPicker';

interface SwapWizardProps {
  tap: TapState;
  beers: Beer[];
  /** Every keg on record (any status/tap) — used only to default the size/volume step
   * from the picked beer's most recent keg (see `lastKegDefaults` below). */
  kegs: Keg[];
  /** Sanitized monitor list (no device key) — used to find a Kegtron Pro monitor bound
   * to this tap, which unlocks the "Import from Kegtron" pick option and the final
   * "Reset volume on device" step. */
  monitors: Monitor[];
  /** Set when opened from the on-deck queue's "Promote" action: skips the beer/size
   * steps entirely (the queued keg already has both) and swaps via `fromKegId`. */
  promoteKeg?: Keg | null;
  onClose: () => void;
  /** Called once the swap itself has succeeded (before any optional Kegtron reset). */
  onDone: () => void;
}

type Step = 'confirm' | 'pick' | 'size' | 'reset';

function tapLabel(tap: TapState): string {
  return tap.tapName ?? `Tap ${tap.tapNumber}`;
}

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

/**
 * The keg swap wizard (Task 5): confirm kicking whatever's currently on tap, pick (or
 * create/import) the next beer, set size/starting volume, then optionally reset a bound
 * Kegtron Pro device's on-board volume counter. Also handles the on-deck "promote" path
 * (`promoteKeg` set) — same confirm + optional reset, but no beer/size steps since a
 * queued keg already carries both.
 */
export function SwapWizard({
  tap, beers, kegs, monitors, promoteKeg = null, onClose, onDone,
}: SwapWizardProps) {
  const hasActiveKeg = tap.keg != null && tap.keg.status === 'on_tap';
  const boundMonitor = monitors.find((m) => m.tapId === tap.tapId && m.type === 'kegtron_pro') ?? null;

  const steps: Step[] = [
    ...(hasActiveKeg || promoteKeg ? (['confirm'] as const) : []),
    ...(promoteKeg ? [] : (['pick', 'size'] as const)),
    ...(boundMonitor ? (['reset'] as const) : []),
  ];

  const [stepIndex, setStepIndex] = useState(0);
  const [pickedBeer, setPickedBeer] = useState<Beer | null>(null);
  const [sizeMl, setSizeMl] = useState('');
  const [volStartMl, setVolStartMl] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<'idle' | 'done' | 'error'>('idle');
  const [resetError, setResetError] = useState<string | null>(null);

  const step = steps[stepIndex];
  const canGoBack = stepIndex > 0 && step !== 'reset';

  // Escape closes the wizard from any step, the same modal-dismiss convention used
  // elsewhere in the admin UI. Safe even mid-flow: nothing is committed before a step's
  // own submit button runs `doSwap`, and once the swap HAS succeeded (the 'reset' step),
  // closing is exactly what "Finish" already does.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function doSwap(input: { beerId: number; sizeMl: number; volStartMl: number } | { fromKegId: number }) {
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
    const defaults = lastKegDefaults(beer.id, kegs);
    setSizeMl(defaults.sizeMl);
    setVolStartMl(defaults.volStartMl);
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
    void doSwap({ beerId: pickedBeer.id, sizeMl: size, volStartMl: start });
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

  return (
    <div className="swap-wizard__backdrop" data-testid="swap-wizard-backdrop" onClick={onClose}>
      <div
        className="swap-wizard"
        role="dialog"
        aria-modal="true"
        aria-label={promoteKeg ? 'Promote on-deck keg' : `Swap keg on ${tapLabel(tap)}`}
        data-testid="swap-wizard"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="swap-wizard__title font-display">
          {promoteKeg ? `Promote on-deck keg — ${tapLabel(tap)}` : `Swap keg — ${tapLabel(tap)}`}
        </h2>

        {step === 'confirm' && (
          <div data-testid="swap-wizard-step-confirm">
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
              <p role="alert" data-testid="swap-wizard-swap-error">{swapError}</p>
            )}
            <div className="swap-wizard__actions">
              <button
                type="button"
                data-testid="swap-wizard-kick-button"
                disabled={swapping}
                onClick={handleConfirm}
              >
                {swapping ? 'Working…' : hasActiveKeg ? 'Kick keg' : 'Tap this keg'}
              </button>
              <button type="button" data-testid="swap-wizard-cancel" onClick={onClose} disabled={swapping}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'pick' && (
          <div data-testid="swap-wizard-step-pick">
            <BeerPicker
              beers={beers}
              allowCreate
              kegtronMonitorId={boundMonitor?.id ?? null}
              onPick={handlePick}
            />
            <div className="swap-wizard__actions">
              {canGoBack && (
                <button type="button" data-testid="swap-wizard-back" onClick={() => setStepIndex(stepIndex - 1)}>
                  Back
                </button>
              )}
              <button type="button" data-testid="swap-wizard-cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'size' && pickedBeer && (
          <div data-testid="swap-wizard-step-size">
            <p className="swap-wizard__picked">{pickedBeer.name}</p>
            <div className="tap-form__grid">
              <label className="admin-field">
                <span>Size (mL)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="swap-wizard-size"
                  value={sizeMl}
                  onChange={(e) => setSizeMl(e.target.value)}
                />
              </label>
              <label className="admin-field">
                <span>Starting volume (mL)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="swap-wizard-volstart"
                  value={volStartMl}
                  onChange={(e) => setVolStartMl(e.target.value)}
                />
              </label>
            </div>
            {sizeError && (
              <p role="alert" data-testid="swap-wizard-size-error">{sizeError}</p>
            )}
            {swapError && (
              <p role="alert" data-testid="swap-wizard-swap-error">{swapError}</p>
            )}
            <div className="swap-wizard__actions">
              <button
                type="button"
                data-testid="swap-wizard-submit"
                disabled={swapping}
                onClick={handleSizeSubmit}
              >
                {swapping ? 'Tapping…' : 'Tap this keg'}
              </button>
              {canGoBack && (
                <button type="button" data-testid="swap-wizard-back" onClick={() => setStepIndex(stepIndex - 1)}>
                  Back
                </button>
              )}
              <button type="button" data-testid="swap-wizard-cancel" onClick={onClose} disabled={swapping}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'reset' && (
          <div data-testid="swap-wizard-step-reset">
            <p>{tapLabel(tap)} is now on tap.</p>
            <p>This monitor is a Kegtron Pro — you can reset its on-device volume counter to match.</p>
            {resetResult === 'done' && (
              <p data-testid="swap-wizard-reset-done">Volume reset on the device.</p>
            )}
            {resetResult === 'error' && (
              <p role="alert" data-testid="swap-wizard-reset-error">{resetError}</p>
            )}
            <div className="swap-wizard__actions">
              {resetResult !== 'done' && (
                <button
                  type="button"
                  data-testid="swap-wizard-reset-button"
                  disabled={resetting}
                  onClick={handleResetVolume}
                >
                  {resetting ? 'Resetting…' : 'Reset volume on device'}
                </button>
              )}
              <button type="button" data-testid="swap-wizard-finish" onClick={onClose}>
                Finish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
