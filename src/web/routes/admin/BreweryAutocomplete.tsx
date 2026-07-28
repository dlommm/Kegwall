import { useEffect, useState } from 'react';
// From core/lookupTypes.ts, NOT routes/lookup.ts — see that core module's doc comment.
import type { BreweryLookupResult } from '../../../server/core/lookupTypes.js';
import { lookupBreweries } from '../../lib/adminApi';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

interface BreweryAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * A plain text input for the beers form's "brewery" field, with a debounced (300ms,
 * per the Task 4 brief) suggestion dropdown sourced from `GET /api/lookup/breweries`.
 * Stays a normal text field either way — picking a suggestion just fills it in, typing
 * something not in the list is always allowed (Open Brewery DB doesn't cover every
 * brewery, and this app never blocks on an external service's coverage).
 */
export function BreweryAutocomplete({ id, value, onChange }: BreweryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<BreweryLookupResult[]>([]);
  const debouncedValue = useDebouncedValue(value, DEBOUNCE_MS);

  useEffect(() => {
    const query = debouncedValue.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    lookupBreweries(query).then((result) => {
      if (cancelled) return;
      setSuggestions(result.ok ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedValue]);

  function handleSelect(name: string) {
    onChange(name);
    setSuggestions([]);
    setOpen(false);
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="brewery-autocomplete">
      <input
        id={id}
        type="text"
        className="admin-field__input"
        data-testid="brewery-input"
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Suggestion buttons below preventDefault their onMouseDown, which keeps this
        // input focused through the click — so by the time a REAL blur reaches here
        // (tabbing away, clicking outside), any in-flight selection has already run.
        onBlur={() => setOpen(false)}
      />
      {showList && (
        <ul className="brewery-autocomplete__list" data-testid="brewery-suggestions">
          {suggestions.map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key -- brewery names aren't unique
            <li key={`${s.name}-${i}`}>
              <button
                type="button"
                className="brewery-autocomplete__option"
                data-testid="brewery-suggestion"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s.name)}
              >
                <span className="brewery-autocomplete__name">{s.name}</span>
                {(s.city || s.state) && (
                  <span className="brewery-autocomplete__meta">
                    {[s.city, s.state].filter(Boolean).join(', ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
