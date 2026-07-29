import { useState } from 'react';
import { BEER_STYLES } from '../../data/beerStyles';

const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 8;

interface StyleAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}

/** Case-insensitive substring match against `BEER_STYLES`, capped at `MAX_SUGGESTIONS` —
 * pure and synchronous, no debounce needed (unlike `BreweryAutocomplete`'s network-backed
 * suggestions): the whole list is already in memory, so filtering it is cheap enough to
 * run on every keystroke directly in render. */
function filterStyles(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return [];
  const out: string[] = [];
  for (const style of BEER_STYLES) {
    if (style.toLowerCase().includes(needle)) {
      out.push(style);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
  }
  return out;
}

/**
 * A plain text input for the beers form's "style" field, with an offline (no network, no
 * debounce) suggestion dropdown sourced from the BJCP 2021 style list (`data/beerStyles.ts`)
 * — added when the Untappd search sheet (which used to autofill style from a search result)
 * was removed entirely, so the form still helps fill this field in without any external
 * API. Same look/feel and keyboard interaction as `BreweryAutocomplete`: a normal text
 * field either way — picking a suggestion just fills it in, typing something not in the
 * list (a custom or house style name) is always allowed and never blocked.
 */
export function StyleAutocomplete({ id, value, onChange }: StyleAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const suggestions = filterStyles(value);
  const showList = open && suggestions.length > 0;

  function handleSelect(style: string) {
    onChange(style);
    setOpen(false);
  }

  return (
    <div className="style-autocomplete">
      <input
        id={id}
        type="text"
        className="admin-field__input"
        data-testid="style-input"
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
        // Same convention as BreweryAutocomplete.
        onBlur={() => setOpen(false)}
      />
      {showList && (
        <ul className="style-autocomplete__list" data-testid="style-suggestions">
          {suggestions.map((style) => (
            <li key={style}>
              <button
                type="button"
                className="style-autocomplete__option"
                data-testid="style-suggestion"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(style)}
              >
                {style}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
