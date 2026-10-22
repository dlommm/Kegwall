import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  getRecentPours, getDrinkers, claimPour, createPourer, ratePourPublic,
  type RecentPour, type PublicDrinker,
} from '../lib/api';
import { formatRelativeTime } from '../lib/useRelativeTime';
import { getRememberedPourer, rememberPourer, type RememberedPourer } from '../lib/pourerIdentity';
import { initials } from '../lib/initials';
import { usePolledFetch } from '../lib/usePolledFetch';
import { CLAIM_WINDOW_MINUTES } from '../../server/db/pours.js';

const REFRESH_INTERVAL_MS = 30_000;

/** Background used for a drinker with no `avatarColor` set — a warm neutral that reads
 * fine against either the dark taproom sheet or a bright-theme one. */
const FALLBACK_AVATAR_COLOR = '#7A6C58';

type ClaimStatus = 'idle' | 'claiming' | 'success' | 'error';
type ClaimErrorKind = 'conflict' | 'rateLimited' | 'other';
type DrinkersStatus = 'loading' | 'error' | 'loaded';

/** Rate-after-claim quick tags (design 6a) — mirrors the server's RATING_TAGS. */
const RATE_TAGS = ['Crisp', 'Perfect temp', 'Foamy', 'Flat', 'Off flavor'] as const;

/** Design 6a's rate-after-claim: 5 stars + quick tags, shown right on the
 * claim-success panel. The tap's average shows on the wall/menu once rated. */
function RateAfterClaim({ pourId, drinkerId }: { pourId: number; drinkerId: number | undefined }) {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  async function submit(stars: number, chosenTags: string[]) {
    if (drinkerId === undefined) { setState('error'); return; }
    setState('saving');
    const result = await ratePourPublic(pourId, stars, chosenTags, drinkerId);
    setState(result.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return <p className="claim-sheet__rate-thanks" data-testid="claim-sheet-rate-thanks">Thanks — rating saved 🍻</p>;
  }

  return (
    <div className="claim-sheet__rate" data-testid="claim-sheet-rate">
      <p className="claim-sheet__rate-prompt">How was it?</p>
      <div className="claim-sheet__stars" role="group" aria-label="Rate this pour">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={star <= rating ? 'claim-sheet__star claim-sheet__star--on' : 'claim-sheet__star'}
            data-testid="claim-sheet-star"
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            disabled={state === 'saving'}
            onClick={() => {
              setRating(star);
              submit(star, tags);
            }}
          >
            ★
          </button>
        ))}
      </div>
      <div className="claim-sheet__rate-tags">
        {RATE_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className={tags.includes(tag) ? 'claim-sheet__rate-tag claim-sheet__rate-tag--on' : 'claim-sheet__rate-tag'}
            data-testid="claim-sheet-rate-tag"
            disabled={state === 'saving'}
            onClick={() => {
              const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
              setTags(next);
              if (rating > 0) submit(rating, next);
            }}
          >
            {tag}
          </button>
        ))}
      </div>
      {state === 'error' && <p className="claim-sheet__rate-error" role="alert">Couldn&rsquo;t save the rating.</p>}
    </div>
  );
}

interface DrinkerPickerSheetProps {
  pour: RecentPour;
  drinkers: PublicDrinker[];
  drinkersStatus: DrinkersStatus;
  status: ClaimStatus;
  errorKind: ClaimErrorKind | null;
  claimedDrinker: PublicDrinker | null;
  /** "Your phone remembers you" (design 3b) — offered as a one-tap claim on top. */
  remembered: RememberedPourer | null;
  onSelectDrinker: (drinker: PublicDrinker) => void;
  /** Name-only passwordless signup + claim in one step (design 3b's join). */
  onSignupAndClaim: (name: string) => void;
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
  pour, drinkers, drinkersStatus, status, errorKind, claimedDrinker, remembered,
  onSelectDrinker, onSignupAndClaim, onRetryDrinkers, onClose,
}: DrinkerPickerSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [signupName, setSignupName] = useState('');

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
            <RateAfterClaim pourId={pour.id} drinkerId={claimedDrinker?.id} />
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
            {remembered && (
              <button
                type="button"
                className="claim-sheet__remembered"
                data-testid="claim-sheet-remembered"
                disabled={status === 'claiming'}
                onClick={() => onSelectDrinker({ id: remembered.id, displayName: remembered.name, avatarColor: null })}
              >
                {`That was me — ${remembered.name} 🍺`}
              </button>
            )}
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
                        {initials(drinker.displayName)}
                      </span>
                      <span className="claim-sheet__drinker-name font-body">{drinker.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="claim-sheet__signup" data-testid="claim-sheet-signup">
              <p className="claim-sheet__signup-hint font-body">
                New here? Just a name — no email, no password. Your phone remembers you.
              </p>
              <div className="claim-sheet__signup-row">
                <input
                  type="text"
                  className="claim-sheet__signup-name"
                  data-testid="claim-sheet-signup-name"
                  value={signupName}
                  maxLength={40}
                  placeholder="Your name"
                  onChange={(e) => setSignupName(e.target.value)}
                />
                <button
                  type="button"
                  className="claim-sheet__signup-join"
                  data-testid="claim-sheet-signup-join"
                  disabled={status === 'claiming' || signupName.trim() === ''}
                  onClick={() => onSignupAndClaim(signupName.trim())}
                >
                  Join &amp; claim
                </button>
              </div>
            </div>
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
  const [poursStatus, setPoursStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [poursRetry, setPoursRetry] = useState(0);
  const [pours, setPours] = useState<RecentPour[]>([]);
  const [remembered, setRemembered] = useState<RememberedPourer | null>(() => getRememberedPourer());
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

  usePolledFetch((isCancelled) => {
    getRecentPours().then((result) => {
      if (isCancelled()) return;
      if (result.ok) { setPours(result.data); setPoursStatus('loaded'); }
      else setPoursStatus('error');
    });
  }, { intervalMs: REFRESH_INTERVAL_MS, restartKey: poursRetry });

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
        // "Your phone remembers you" (design 3b): claiming as someone IS the
        // identity signal on a personal phone — next time it's a one-tap claim.
        rememberPourer({ id: drinker.id, name: drinker.displayName });
        setRemembered({ id: drinker.id, name: drinker.displayName });
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

  /** Design 3b's join: name-only signup, then claim the selected pour as the
   * brand-new pourer in one flow. Reuses handleSelectDrinker so every claim
   * outcome (success/409/429) renders identically to an existing-drinker claim. */
  async function handleSignupAndClaim(name: string) {
    if (!selectedPour || claimInFlightRef.current) return;
    // Same synchronous check-AND-SET as handleSelectDrinker — checking without setting
    // left the exact double-tap window the ref exists to close: two taps in one JS turn
    // both passed the guard and fired two createPourer calls, minting two identical
    // drinker profiles (only one of which then claimed the pour).
    claimInFlightRef.current = true;
    setStatus('claiming');
    setErrorKind(null);
    let created: Awaited<ReturnType<typeof createPourer>>;
    try {
      created = await createPourer(name);
      if (selectedPourRef.current?.id !== selectedPour.id) return;
      if (!created.ok) {
        setStatus('error');
        setErrorKind(created.status === 429 ? 'rateLimited' : 'other');
        return;
      }
    } finally {
      // Release before delegating: handleSelectDrinker re-acquires synchronously in the
      // same microtask (no await between here and the call below), so no second tap can
      // interleave between the release and the re-acquire.
      claimInFlightRef.current = false;
    }
    await handleSelectDrinker({
      id: created.data.id,
      displayName: created.data.displayName,
      avatarColor: created.data.avatarColor,
    });
  }

  return (
    <section className="claim-sheet" data-testid="claim-sheet" aria-labelledby="claim-sheet-section-heading">
      <h2 id="claim-sheet-section-heading" className="claim-sheet__heading font-display">Claim your pour</h2>

      <div className="claim-sheet__toolbar">
        <p className="claim-sheet__hint" data-testid="claim-sheet-hint">
          Pours can be claimed for {CLAIM_WINDOW_MINUTES} minutes. Ask your host to assign older ones.
        </p>
        <button
          type="button"
          className="claim-sheet__refresh"
          data-testid="claim-sheet-refresh"
          disabled={poursStatus === 'loading'}
          onClick={() => { setPoursStatus('loading'); setPoursRetry((value) => value + 1); }}
        >
          {poursStatus === 'loading' ? 'Refreshing…' : 'Refresh pours'}
        </button>
      </div>
      {poursStatus === 'error' && (
        <p className="claim-sheet__notice claim-sheet__notice--error" role="alert" data-testid="claim-sheet-load-error">
          {pours.length > 0 ? 'Couldn’t refresh pours. Showing the last list.' : 'Couldn’t load pours. Tap Refresh to try again.'}
        </p>
      )}
      {poursStatus === 'loading' && pours.length === 0 && <p className="claim-sheet__empty" role="status">Loading pours…</p>}
      {pours.length === 0 ? (
        poursStatus === 'loaded' ? <p className="claim-sheet__empty" data-testid="claim-sheet-empty">No pours to claim right now.</p> : null
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

      {/* Sticky bottom claim bar (redesign 2b) — a full-width CTA that floats over the fold
          so unclaimed pours aren't buried; opens the picker for the most recent one. */}
      {pours.length > 0 && !selectedPour && (
        <button
          type="button"
          className="claim-sheet__sticky"
          data-testid="claim-sheet-sticky"
          onClick={() => setSelectedPour(pours[0]!)}
        >
          {`${pours.length} pour${pours.length === 1 ? '' : 's'} waiting to be claimed →`}
        </button>
      )}

      {selectedPour && (
        <DrinkerPickerSheet
          pour={selectedPour}
          drinkers={drinkers}
          drinkersStatus={drinkersStatus}
          status={status}
          errorKind={errorKind}
          claimedDrinker={claimedDrinker}
          remembered={remembered}
          onSelectDrinker={handleSelectDrinker}
          onSignupAndClaim={handleSignupAndClaim}
          onRetryDrinkers={retryDrinkers}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}
