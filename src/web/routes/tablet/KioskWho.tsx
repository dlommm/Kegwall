import { useRef, useState, type ReactNode } from 'react';
import type { PublicPourer } from '../../lib/api';
import { initials } from '../../lib/initials';
import { formatRelativeTime } from '../../lib/useRelativeTime';

export interface KioskPourer {
  id: number;
  name: string;
  color: string | null;
}

export interface KioskWhoProps {
  pourers: PublicPourer[];
  pourersStatus: 'loading' | 'loaded' | 'error';
  busy: boolean;
  clock: string;
  faceSignIn: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (pourer: KioskPourer) => void;
  onNew: () => void;
  /** The group-tab panel and its Start button (session mode, design 6c). */
  session: ReactNode;
}

const FALLBACK_COLOR = '#7A6C58';

function toKiosk(p: PublicPourer): KioskPourer {
  return { id: p.id, name: p.displayName, color: p.avatarColor };
}

/**
 * The kiosk's "Who's pouring?" screen (Kegwall V2 M10, blueprint §E.6; fixes issue 17): a 56 px
 * search once the roster is long, the two people who poured most recently as big tiles, then
 * everyone as 64 px avatars on 132 px tiles, and a 64 px "I'm new". Big rosters get an A–Z
 * rail to jump by first letter.
 */
export function KioskWho({
  pourers, pourersStatus, busy, clock, faceSignIn, error, onRetry, onPick, onNew, session,
}: KioskWhoProps) {
  const [query, setQuery] = useState('');
  const avatarsRef = useRef<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? pourers.filter((p) => p.displayName.toLowerCase().includes(q)) : pourers;
  const recent = q ? [] : [...pourers]
    .filter((p) => p.lastPourAt)
    .sort((a, b) => (b.lastPourAt! > a.lastPourAt! ? 1 : -1))
    .slice(0, 2);

  return (
    <div className="tablet-screen kiosk-who" data-testid="tablet-grid">
      <header className="tablet-screen__header">
        <h1 className="kiosk-title">Who’s pouring?</h1>
        <span className="tablet-screen__header-right">
          {faceSignIn && <span className="tablet-face-chip" data-testid="tablet-face-chip">FACE SIGN-IN ON</span>}
          <span className="tablet-screen__clock font-tabular">{clock}</span>
        </span>
      </header>

      {pourersStatus === 'error' && (
        <p className="tablet-screen__quiet" role="alert">
          Couldn’t load pourers.
          {' '}
          <button type="button" className="tablet-screen__link" onClick={onRetry}>Try again</button>
        </p>
      )}
      {error && <p className="tablet-screen__error" role="alert" data-testid="tablet-pick-error">{error}</p>}

      {pourers.length > 8 && (
        <input
          type="search"
          className="kiosk-search"
          data-testid="tablet-pourer-search"
          placeholder={`Find your name — ${pourers.length} pourers`}
          aria-label="Find your name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {recent.length > 0 && (
        <div className="kiosk-recent" data-testid="tablet-recent">
          {recent.map((p) => (
            <button
              key={p.id}
              type="button"
              className="kiosk-recent__tile"
              data-testid="tablet-recent-tile"
              disabled={busy}
              onClick={() => onPick(toKiosk(p))}
            >
              <span className="kiosk-avatar kiosk-avatar--big" style={{ backgroundColor: p.avatarColor ?? FALLBACK_COLOR }}>
                {initials(p.displayName)}
              </span>
              <span className="kiosk-recent__text">
                <b>{p.displayName}</b>
                <span className="font-tabular">{`poured ${formatRelativeTime(p.lastPourAt!)}`}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="tablet-grid__body">
        <div className="kiosk-tiles" data-testid="tablet-avatars" ref={avatarsRef}>
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              className="kiosk-tile"
              data-testid="tablet-avatar"
              data-initial={(p.displayName.trim()[0] ?? '#').toUpperCase()}
              disabled={busy}
              onClick={() => onPick(toKiosk(p))}
            >
              <span className="kiosk-avatar" style={{ backgroundColor: p.avatarColor ?? FALLBACK_COLOR }}>
                {initials(p.displayName)}
              </span>
              <span className="kiosk-tile__name">{p.displayName}</span>
              <span className="kiosk-tile__pours font-tabular">{`${p.pourCount} pours`}</span>
            </button>
          ))}
          {q && shown.length === 0 && <p className="tablet-screen__quiet">{`No one called “${query.trim()}” yet. Tap “I’m new”.`}</p>}
        </div>
        {/* A–Z rail: a redundant visual shortcut (every name is a real button in the grid),
            so it stays out of the accessibility tree and the focus order. */}
        {!q && pourers.length > 12 && (
          <div className="tablet-az-rail" data-testid="tablet-az-rail" aria-hidden="true">
            {[...new Set(pourers.map((p) => (p.displayName.trim()[0] ?? '#').toUpperCase()))]
              .sort()
              .map((letter) => (
                <button
                  key={letter}
                  type="button"
                  tabIndex={-1}
                  className="tablet-az-rail__letter"
                  data-testid="tablet-az-letter"
                  onClick={() => avatarsRef.current
                    ?.querySelector(`[data-initial="${letter}"]`)
                    ?.scrollIntoView({ block: 'nearest' })}
                >
                  {letter}
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="tablet-grid__footer">
        <button type="button" className="kiosk-new" data-testid="tablet-signup-button" onClick={onNew}>
          I’M NEW — SIGN ME UP
        </button>
        {session}
        <span className="tablet-grid__hint">or scan the QR on the wall with your phone</span>
      </div>
    </div>
  );
}
