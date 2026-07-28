import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  getRecentPours, getDrinkers, claimPour, type RecentPour, type PublicDrinker,
} from '../lib/api';
import { formatRelativeTime } from '../lib/useRelativeTime';

const REFRESH_INTERVAL_MS = 30_000;

/** Background used for a drinker with no `avatarColor` set — a warm neutral that reads
 * fine against either the dark taproom sheet or a bright-theme one. */
const FALLBACK_AVATAR_COLOR = '#7A6C58';

type ClaimStatus = 'idle' | 'claiming' | 'success' | 'error';
type ClaimErrorKind = 'conflict' | 'rateLimited' | 'other';
type DrinkersStatus = 'loading' | 'error' | 'loaded';

/** First letter of the first and last "words" in a display name (e.g. "Sam Lee" -> "SL",
 * a single-word name -> just that letter). Never empty — an all-whitespace name falls
 * back to "?" rather than rendering a blank avatar. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

interface DrinkerPickerSheetProps {
  pour: RecentPour;
  drinkers: PublicDrinker[];
  drinkersStatus: DrinkersStatus;
  status: ClaimStatus;
  errorKind: ClaimErrorKind | null;
  claimedDrinker: PublicDrinker | null;
  onSelectDrinker: (drinker: PublicDrinker) => void;
  onRetryDrinkers: () => void;
  onClose: () => void;
}

/**
 * The "who's this pour for?" sheet: opened by tapping a pour in the unclaimed list,
 * dismissible via Escape (wired by the parent `ClaimSheet`, since it owns the open/close
 * state) or a backdrop click (handled right here). Renders one of three end states in
 * place of the drinker list — success, "already claimed" (409, no point retrying), or a
 * plain retry notice (429/other, list stays visible so a fresh tap just retries).
 */
function DrinkerPickerSheet({
  pour, drinkers, drinkersStatus, status, errorKind, claimedDrinker, onSelectDrinker, onRetryDrinkers, onClose,
}: DrinkerPickerSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  const showList = status !== 'success' && errorKind !== 'conflict';

  return (
    <div
      className="claim-sheet__backdrop"
      data-testid="claim-sheet-backdrop"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className="claim-sheet__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-sheet-heading"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="claim-sheet__sheet-header">
          <h3 id="claim-sheet-heading" className="claim-sheet__sheet-title font-display">
            {pour.beerName}
          </h3>
          <button
            type="button"
            className="claim-sheet__dismiss"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {status === 'success' && (
          <div className="claim-sheet__notice claim-sheet__notice--success" data-testid="claim-sheet-success" role="status">
            <p>{`Claimed for ${claimedDrinker?.displayName ?? 'you'}.`}</p>
            <button type="button" className="claim-sheet__done" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {status === 'error' && errorKind === 'conflict' && (
          <div className="claim-sheet__notice claim-sheet__notice--conflict" data-testid="claim-sheet-conflict" role="alert">
            <p>Already claimed — someone beat you to it.</p>
            <button type="button" className="claim-sheet__done" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {showList && (
          <>
            <p className="claim-sheet__prompt font-body">Who&rsquo;s this pour for?</p>
            {status === 'claiming' && (
              <p className="claim-sheet__status" data-testid="claim-sheet-claiming">Claiming…</p>
            )}
            {status === 'error' && errorKind === 'rateLimited' && (
              <p className="claim-sheet__notice claim-sheet__notice--rate-limited" data-testid="claim-sheet-rate-limited" role="alert">
                Slow down — try again in a moment.
              </p>
            )}
            {status === 'error' && errorKind === 'other' && (
              <p className="claim-sheet__notice claim-sheet__notice--error" data-testid="claim-sheet-error" role="alert">
                Something went wrong. Try again.
              </p>
            )}
            {drinkersStatus === 'loading' && (
              <p className="claim-sheet__status" data-testid="claim-sheet-drinkers-loading">Loading drinkers…</p>
            )}
            {drinkersStatus === 'error' && (
              <div className="claim-sheet__notice claim-sheet__notice--error" data-testid="claim-sheet-drinkers-error" role="alert">
                <p>Couldn&rsquo;t load drinkers.</p>
                <button
                  type="button"
                  className="claim-sheet__retry"
                  data-testid="claim-sheet-drinkers-retry"
                  onClick={onRetryDrinkers}
                >
                  Try again
                </button>
              </div>
            )}
            {drinkersStatus === 'loaded' && (
              <ul className="claim-sheet__drinker-list" data-testid="claim-sheet-drinkers">
                {drinkers.map((drinker) => (
                  <li key={drinker.id}>
                    <button
                      type="button"
                      className="claim-sheet__drinker-button"
                      data-testid="claim-sheet-drinker"
                      disabled={status === 'claiming'}
                      onClick={() => onSelectDrinker(drinker)}
                    >
                      <span
                        className="claim-sheet__avatar font-tabular"
                        aria-hidden="true"
                        style={{ backgroundColor: drinker.avatarColor ?? FALLBACK_AVATAR_COLOR }}
                      >
                        {getInitials(drinker.displayName)}
                      </span>
                      <span className="claim-sheet__drinker-name font-body">{drinker.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Claim your pour": the menu's recent-unclaimed-pours list plus the drinker-picker claim
 * flow (Task 6 plan). Pours refresh every 30s (auto-refresh, cleaned up on unmount);
 * tapping one opens `DrinkerPickerSheet`. A claim resolves into one of: success, a 409
 * "already claimed" notice (pointless to retry — someone else got there first), a gentle
 * 429 "slow down" notice, or a plain retry message for anything else — see
 * `DrinkerPickerSheet` for how each renders.
 */
export function ClaimSheet() {
  const [pours, setPours] = useState<RecentPour[]>([]);
  const [drinkers, setDrinkers] = useState<PublicDrinker[]>([]);
  const [drinkersStatus, setDrinkersStatus] = useState<DrinkersStatus>('loading');
  const [drinkersRetryToken, setDrinkersRetryToken] = useState(0);
  const [selectedPour, setSelectedPour] = useState<RecentPour | null>(null);
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [errorKind, setErrorKind] = useState<ClaimErrorKind | null>(null);
  const [claimedDrinker, setClaimedDrinker] = useState<PublicDrinker | null>(null);

  // "Latest value" ref for the current selection: read from inside handleSelectDrinker's
  // async continuation below, where a plain closure over `selectedPour` would stay pinned
  // to whatever it was when that particular call started rather than reflecting whether
  // the selection has since moved on (sheet closed, or a different pour opened) — see the
  // generation-guard comment there.
  const selectedPourRef = useRef<RecentPour | null>(null);
  selectedPourRef.current = selectedPour;

  // Synchronous re-entrancy guard: two clicks landing in the same JS turn (e.g. a fast
  // double-tap) both fire before React's `disabled={status === 'claiming'}` re-render can
  // apply to the real DOM, so without this a second `claimPour` call could go out before
  // the first's response lands — and if that second response came back a 409 (the pour
  // already got claimed by the first call), it would clobber the user's own success state
  // with an "already claimed" notice. Checked-and-set synchronously, before any `await`,
  // so there's no window for a second call to slip through; reset in `finally` regardless
  // of how the call ends.
  const claimInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const loadPours = () => {
      getRecentPours().then((result) => {
        if (!cancelled && result.ok) setPours(result.data);
      });
    };
    loadPours();
    const id = setInterval(loadPours, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const isSheetOpen = selectedPour !== null;

  // Drinkers used to be fetched once at mount and never retried — a transient failure
  // left the picker's drinker list empty for the rest of the session, with no recovery
  // short of a full page reload (Phase 3 final review, finding I3). Re-fetching on every
  // sheet open is simpler than a background retry/backoff loop and self-heals naturally:
  // each open is a fresh attempt. `drinkersRetryToken` lets the "Try again" button
  // (DrinkerPickerSheet) re-run this effect without closing the sheet.
  useEffect(() => {
    if (!isSheetOpen) return undefined;
    let cancelled = false;
    setDrinkersStatus('loading');
    getDrinkers().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDrinkers(result.data);
        setDrinkersStatus('loaded');
      } else {
        setDrinkersStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isSheetOpen, drinkersRetryToken]);

  const retryDrinkers = useCallback(() => {
    setDrinkersRetryToken((n) => n + 1);
  }, []);

  const closeSheet = useCallback(() => {
    setSelectedPour(null);
    setStatus('idle');
    setErrorKind(null);
    setClaimedDrinker(null);
  }, []);

  useEffect(() => {
    if (!selectedPour) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPour, closeSheet]);

  async function handleSelectDrinker(drinker: PublicDrinker) {
    if (!selectedPour) return;
    if (claimInFlightRef.current) return;
    claimInFlightRef.current = true;

    const pourId = selectedPour.id;
    setStatus('claiming');
    setErrorKind(null);

    try {
      const result = await claimPour(pourId, drinker.id);

      // Generation guard: ignore a stale response if the selection has moved on (sheet
      // closed, or a different pour opened) since this specific call started — applying
      // it now would show the wrong pour's claim result on whatever's currently open.
      if (selectedPourRef.current?.id !== pourId) return;

      if (result.ok) {
        setStatus('success');
        setClaimedDrinker(drinker);
        setPours((prev) => prev.filter((p) => p.id !== pourId));
        return;
      }
      if (result.status === 409) {
        setStatus('error');
        setErrorKind('conflict');
        setPours((prev) => prev.filter((p) => p.id !== pourId));
        return;
      }
      if (result.status === 429) {
        setStatus('error');
        setErrorKind('rateLimited');
        return;
      }
      setStatus('error');
      setErrorKind('other');
    } finally {
      claimInFlightRef.current = false;
    }
  }

  return (
    <section className="claim-sheet" data-testid="claim-sheet" aria-labelledby="claim-sheet-section-heading">
      <h2 id="claim-sheet-section-heading" className="claim-sheet__heading font-display">Claim your pour</h2>

      {pours.length === 0 ? (
        <p className="claim-sheet__empty" data-testid="claim-sheet-empty">No pours to claim right now.</p>
      ) : (
        <ul className="claim-sheet__list" data-testid="claim-sheet-list">
          {pours.map((pour) => (
            <li key={pour.id}>
              <button
                type="button"
                className="claim-sheet__pour-button"
                data-testid="claim-sheet-pour"
                onClick={() => setSelectedPour(pour)}
              >
                <span className="claim-sheet__pour-info">
                  <span className="claim-sheet__pour-beer font-body">{pour.beerName}</span>
                  <span className="claim-sheet__pour-meta font-tabular">
                    {pour.tapNumber != null ? `Tap ${pour.tapNumber} · ` : ''}
                    {formatRelativeTime(pour.ts)}
                  </span>
                </span>
                <span className="claim-sheet__pour-cta">That was me</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedPour && (
        <DrinkerPickerSheet
          pour={selectedPour}
          drinkers={drinkers}
          drinkersStatus={drinkersStatus}
          status={status}
          errorKind={errorKind}
          claimedDrinker={claimedDrinker}
          onSelectDrinker={handleSelectDrinker}
          onRetryDrinkers={retryDrinkers}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}
