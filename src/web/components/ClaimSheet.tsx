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
  status: ClaimStatus;
  errorKind: ClaimErrorKind | null;
  claimedDrinker: PublicDrinker | null;
  onSelectDrinker: (drinker: PublicDrinker) => void;
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
  pour, drinkers, status, errorKind, claimedDrinker, onSelectDrinker, onClose,
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
  const [selectedPour, setSelectedPour] = useState<RecentPour | null>(null);
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [errorKind, setErrorKind] = useState<ClaimErrorKind | null>(null);
  const [claimedDrinker, setClaimedDrinker] = useState<PublicDrinker | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    getDrinkers().then((result) => {
      if (!cancelled && result.ok) setDrinkers(result.data);
    });
    return () => {
      cancelled = true;
    };
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
    setStatus('claiming');
    setErrorKind(null);
    const result = await claimPour(selectedPour.id, drinker.id);

    if (result.ok) {
      setStatus('success');
      setClaimedDrinker(drinker);
      setPours((prev) => prev.filter((p) => p.id !== selectedPour.id));
      return;
    }
    if (result.status === 409) {
      setStatus('error');
      setErrorKind('conflict');
      setPours((prev) => prev.filter((p) => p.id !== selectedPour.id));
      return;
    }
    if (result.status === 429) {
      setStatus('error');
      setErrorKind('rateLimited');
      return;
    }
    setStatus('error');
    setErrorKind('other');
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
          status={status}
          errorKind={errorKind}
          claimedDrinker={claimedDrinker}
          onSelectDrinker={handleSelectDrinker}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}
