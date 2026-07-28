import { useEffect, useState } from 'react';
// From core/lookupTypes.ts, NOT routes/lookup.ts — see that core module's doc comment.
import type { UntappdLookupResult } from '../../../server/core/lookupTypes.js';
import { lookupUntappd, importUntappdLabel } from '../../lib/adminApi';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

const DEBOUNCE_MS = 300;

/** The fields the beers form pre-fills from a picked Untappd result — everything the
 * search response carries except `labelUrl`, which becomes the LOCAL `/labels/...` path
 * returned by the import download (see `handlePick` below; the remote Untappd URL itself
 * is never handed back to the parent — this app never hotlinks Untappd's CDN, per the
 * Task 4 brief). */
export interface UntappdImportedFields {
  name: string;
  brewery: string | null;
  style: string | null;
  abv: number | null;
  ibu: number | null;
  labelImage: string | null;
}

type Status = 'idle' | 'loading' | 'loaded' | 'error';

interface UntappdSearchSheetProps {
  onImported: (fields: UntappdImportedFields) => void;
  onClose: () => void;
}

/**
 * The beers form's "Search Untappd" sheet (Task 4). The PARENT (`BeerForm`) is
 * responsible for never rendering this component at all when Untappd isn't configured
 * (a 501 from a probe call — see BeerForm) — this component assumes it's only ever
 * mounted when the feature is live, so it has no 501-specific UI of its own.
 *
 * Deliberately renders NO `<img>` from a search result's remote `labelUrl` — even as a
 * "here's a preview" thumbnail before import — so nothing in the admin UI ever hotlinks
 * Untappd's CDN (per "never hotlink" in the Task 4 brief); a local thumbnail only exists
 * once `importUntappdLabel` has downloaded it server-side, which is `handlePick` below.
 */
export function UntappdSearchSheet({ onImported, onClose }: UntappdSearchSheetProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<UntappdLookupResult[]>([]);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    lookupUntappd(q).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setResults(result.data);
        setStatus('loaded');
      } else {
        setResults([]);
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handlePick(result: UntappdLookupResult, index: number) {
    setImportError(null);
    if (!result.labelUrl) {
      onImported({
        name: result.name, brewery: result.brewery, style: result.style,
        abv: result.abv, ibu: result.ibu, labelImage: null,
      });
      return;
    }
    setImportingIndex(index);
    const imported = await importUntappdLabel(result.labelUrl);
    setImportingIndex(null);
    if (!imported.ok) {
      setImportError("Couldn't download that beer's label art — try another result, or add a label separately.");
      return;
    }
    onImported({
      name: result.name, brewery: result.brewery, style: result.style,
      abv: result.abv, ibu: result.ibu, labelImage: imported.data.path,
    });
  }

  return (
    <div
      className="untappd-sheet__backdrop"
      data-testid="untappd-sheet-backdrop"
      onClick={onClose}
    >
      <div
        className="untappd-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="untappd-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="untappd-sheet__header">
          <h3 id="untappd-sheet-title" className="untappd-sheet__title font-display">Search Untappd</h3>
          <button type="button" className="untappd-sheet__dismiss" onClick={onClose} aria-label="Close">×</button>
        </div>

        <input
          type="text"
          className="untappd-sheet__search"
          data-testid="untappd-search-input"
          placeholder="Search by beer name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {status === 'loading' && (
          <p className="untappd-sheet__status" data-testid="untappd-sheet-loading">Searching…</p>
        )}
        {status === 'error' && (
          <p className="untappd-sheet__notice" role="alert" data-testid="untappd-sheet-error">
            Couldn&rsquo;t reach Untappd. Try again, or fill in the beer by hand.
          </p>
        )}
        {importError && (
          <p className="untappd-sheet__notice" role="alert" data-testid="untappd-sheet-import-error">
            {importError}
          </p>
        )}
        {status === 'loaded' && results.length === 0 && (
          <p className="untappd-sheet__status" data-testid="untappd-sheet-empty">No matches.</p>
        )}
        {status === 'loaded' && results.length > 0 && (
          <ul className="untappd-sheet__results" data-testid="untappd-sheet-results">
            {results.map((r, i) => (
              // eslint-disable-next-line react/no-array-index-key -- Untappd results have no stable client-side id
              <li key={`${r.name}-${i}`}>
                <button
                  type="button"
                  className="untappd-sheet__result"
                  data-testid="untappd-sheet-result"
                  disabled={importingIndex !== null}
                  onClick={() => handlePick(r, i)}
                >
                  <span className="untappd-sheet__result-name font-body">{r.name}</span>
                  <span className="untappd-sheet__result-meta">
                    {[r.brewery, r.style].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span className="untappd-sheet__result-stats font-tabular">
                    {r.abv != null ? `${r.abv}% ABV` : ''}
                    {r.abv != null && r.ibu != null ? ' · ' : ''}
                    {r.ibu != null ? `${r.ibu} IBU` : ''}
                  </span>
                  {importingIndex === i && (
                    <span className="untappd-sheet__importing" data-testid="untappd-sheet-importing">
                      Importing…
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
