import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { pairDisplay, getDisplayView } from '../lib/api';

const STORAGE_KEY = 'kegtron.display';

function loadDisplayId(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

function saveDisplayId(id: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // fine — the TV will just need re-pairing next boot
  }
}

/**
 * `/display` — the TV-side pairing flow (design 7c). First visit: enter the
 * short code from the admin Displays page. Once paired the display remembers
 * itself (localStorage) and every subsequent visit jumps straight to its
 * assigned wall at `/wall/:slug?display=<id>` (WallPage applies the display's
 * look/theme/takeover overrides from that query param).
 */
export function DisplayPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'checking' | 'unpaired' | 'pairing' | 'no-wall'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadDisplayId();
    if (existing == null) {
      setStatus('unpaired');
      return;
    }
    getDisplayView(existing).then((result) => {
      if (result.ok && result.data.wallSlug) {
        navigate(`/wall/${result.data.wallSlug}?display=${result.data.id}`, { replace: true });
      } else if (result.ok) {
        setStatus('no-wall');
      } else {
        // Stale pairing (display deleted) — start over.
        setStatus('unpaired');
      }
    });
  }, [navigate]);

  async function submit() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setStatus('pairing');
    setError(null);
    const result = await pairDisplay(trimmed);
    if (!result.ok) {
      setStatus('unpaired');
      setError(result.status === 404 ? 'No display with that code — check the admin Displays page.' : result.message);
      return;
    }
    saveDisplayId(result.data.id);
    if (result.data.wallSlug) {
      navigate(`/wall/${result.data.wallSlug}?display=${result.data.id}`, { replace: true });
    } else {
      setStatus('no-wall');
    }
  }

  if (status === 'checking') {
    return (
      <main className="display-page" data-testid="display-page-checking">
        <p>…</p>
      </main>
    );
  }

  if (status === 'no-wall') {
    return (
      <main className="display-page" data-testid="display-page-no-wall">
        <h1 className="display-page__title font-display">Paired</h1>
        <p className="display-page__hint">
          This display isn&rsquo;t assigned to a wall yet — pick one on the admin Displays page,
          then reload.
        </p>
      </main>
    );
  }

  return (
    <main className="display-page" data-testid="display-page">
      <h1 className="display-page__title font-display">Pair this display</h1>
      <p className="display-page__hint">
        Enter the pairing code from Admin → Displays.
      </p>
      <div className="display-page__row">
        <input
          type="text"
          className="display-page__code font-tabular"
          data-testid="display-code-input"
          value={code}
          maxLength={12}
          placeholder="e.g. K7KWQD"
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          type="button"
          className="display-page__pair"
          data-testid="display-pair-button"
          disabled={status === 'pairing' || code.trim() === ''}
          onClick={submit}
        >
          {status === 'pairing' ? 'Pairing…' : 'Pair'}
        </button>
      </div>
      {error && <p className="display-page__error" role="alert" data-testid="display-pair-error">{error}</p>}
    </main>
  );
}
