import { useEffect, useState, type FormEvent } from 'react';
// From core/lookupTypes.ts, NOT routes/lookup.ts — see that core module's doc comment.
import type { BeerLookupResult } from '../../../server/core/lookupTypes.js';
import { lookupBeers } from '../../lib/adminApi';

/** The fields the beers form pre-fills from a picked catalog.beer result — every field the
 * search response carries. Unlike the removed `UntappdImportedFields`, there is no
 * `labelImage`/`labelUrl` at all: catalog.beer has no label-art field in its API
 * whatsoever (see `core/lookupTypes.ts`'s `BeerLookupResult` doc comment), so there's
 * nothing to download-and-store here — picking a result never touches the label field. */
export type BeerImportedFields = BeerLookupResult;

type Status = 'idle' | 'loading' | 'loaded' | 'error';

interface BeerSearchSheetProps {
  onImported: (fields: BeerImportedFields) => void;
  onClose: () => void;
}

/**
 * The beers form's "Search catalog.beer" sheet — replaces the removed `UntappdSearchSheet`
 * (mirrors its overall UX: a dismissible bottom sheet, a results list, pick-to-fill). The
 * PARENT (`BeerForm`) is responsible for never rendering this component at all when
 * catalog.beer isn't configured (a 501 from a probe call — see `BeerForm`), same
 * "hidden, not just disabled" contract the removed sheet's trigger button had.
 *
 * The ONE deliberate behavioral difference from the removed Untappd sheet:
 * search-on-SUBMIT (Enter in the field, or the button), never per-keystroke/debounced —
 * catalog.beer's free tier is only 1,000 requests/month, so a "search as you type"
 * interaction (even debounced) would burn through that far too fast for a form field
 * that's typically edited character-by-character. There's also no label-art preview or
 * import step (see `BeerImportedFields`'s doc comment) — picking a result fills text
 * fields only, nothing async.
 */
export function BeerSearchSheet({ onImported, onClose }: BeerSearchSheetProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<BeerLookupResult[]>([]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const result = await lookupBeers(q);
    if (result.ok) {
      setResults(result.data);
      setStatus('loaded');
    } else {
      setResults([]);
      setStatus('error');
    }
  }

  function handlePick(result: BeerLookupResult) {
    onImported(result);
  }

  return (
    <div
      className="beer-search-sheet__backdrop"
      data-testid="beer-search-sheet-backdrop"
      onClick={onClose}
    >
      <div
        className="beer-search-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="beer-search-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="beer-search-sheet__header">
          <h3 id="beer-search-sheet-title" className="beer-search-sheet__title font-display">
            Search catalog.beer
          </h3>
          <button
            type="button"
            className="beer-search-sheet__dismiss"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="beer-search-sheet__form" data-testid="beer-search-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="beer-search-sheet__search"
            data-testid="beer-search-input"
            placeholder="Search by beer name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className="beer-search-sheet__submit" data-testid="beer-search-submit">
            Search
          </button>
        </form>

        {status === 'loading' && (
          <p className="beer-search-sheet__status" data-testid="beer-search-sheet-loading">Searching…</p>
        )}
        {status === 'error' && (
          <p className="beer-search-sheet__notice" role="alert" data-testid="beer-search-sheet-error">
            Couldn&rsquo;t reach catalog.beer. Try again, or fill in the beer by hand.
          </p>
        )}
        {status === 'loaded' && results.length === 0 && (
          <p className="beer-search-sheet__status" data-testid="beer-search-sheet-empty">No matches.</p>
        )}
        {status === 'loaded' && results.length > 0 && (
          <ul className="beer-search-sheet__results" data-testid="beer-search-sheet-results">
            {results.map((r, i) => (
              // eslint-disable-next-line react/no-array-index-key -- catalog.beer results have no stable client-side id
              <li key={`${r.name}-${i}`}>
                <button
                  type="button"
                  className="beer-search-sheet__result"
                  data-testid="beer-search-sheet-result"
                  onClick={() => handlePick(r)}
                >
                  <span className="beer-search-sheet__result-name font-body">{r.name}</span>
                  <span className="beer-search-sheet__result-meta">
                    {[r.brewery, r.style].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span className="beer-search-sheet__result-stats font-tabular">
                    {r.abv != null ? `${r.abv}% ABV` : ''}
                    {r.abv != null && r.ibu != null ? ' · ' : ''}
                    {r.ibu != null ? `${r.ibu} IBU` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
