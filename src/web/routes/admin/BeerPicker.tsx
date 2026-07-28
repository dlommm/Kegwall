import { useState } from 'react';
import type { Beer } from '../../../server/db/beers.js';
import { importKegtronBeer } from '../../lib/adminApi';
import { BeerForm } from './BeerForm';

interface BeerPickerProps {
  beers: Beer[];
  onPick: (beer: Beer) => void;
  /** Shows an "Add new beer" trigger that mounts `BeerForm` (Task 4) inline — the picked
   * beer is whatever `BeerForm` reports saved. */
  allowCreate?: boolean;
  /** A Kegtron Pro monitor's id, when one is bound to the tap being swapped — shows an
   * "Import from Kegtron" trigger that creates a beer from the device's current port
   * config (`POST /api/kegtron/import/:monitorId`) and picks it directly. `null`/omitted
   * hides the trigger entirely (Gen 1-bound or unbound taps have nothing to import). */
  kegtronMonitorId?: number | null;
}

/**
 * The swap wizard's (and the on-deck queue's) "pick a beer" step — three ways in, per the
 * Task 5 brief: filter the already-loaded catalog, create a brand-new beer inline
 * (reusing `BeerForm`), or import one from a bound Kegtron Pro monitor's device config.
 */
export function BeerPicker({ beers, onPick, allowCreate = false, kegtronMonitorId = null }: BeerPickerProps) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const filtered = query.trim() === ''
    ? beers
    : beers.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function handleImport() {
    if (kegtronMonitorId == null) return;
    setImportError(null);
    setImporting(true);
    const result = await importKegtronBeer(kegtronMonitorId);
    setImporting(false);
    if (result.ok) {
      onPick(result.data);
      return;
    }
    // A 502 (device unreachable / mdash error) is surfaced gently, not as a hard
    // failure — the operator can still fall back to searching/creating a beer by hand.
    setImportError(result.status === 502
      ? "Couldn't reach the Kegtron device. Try again, or pick a beer another way."
      : result.message);
  }

  if (creating) {
    return (
      <BeerForm
        mode="create"
        beer={null}
        onSaved={(beer) => {
          setCreating(false);
          onPick(beer);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="beer-picker" data-testid="beer-picker">
      <input
        type="text"
        placeholder="Search beers…"
        aria-label="Search beers"
        data-testid="beer-picker-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="beer-picker__actions">
        {allowCreate && (
          <button
            type="button"
            className="beer-picker__create"
            data-testid="beer-picker-create-button"
            onClick={() => setCreating(true)}
          >
            Add new beer
          </button>
        )}
        {kegtronMonitorId != null && (
          <button
            type="button"
            className="beer-picker__import"
            data-testid="beer-picker-import-button"
            disabled={importing}
            onClick={handleImport}
          >
            {importing ? 'Importing…' : 'Import from Kegtron'}
          </button>
        )}
      </div>

      {importError && (
        <p className="beer-picker__notice" role="alert" data-testid="beer-picker-import-error">
          {importError}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="beer-picker__empty" data-testid="beer-picker-empty">
          {beers.length === 0 ? 'No beers in the catalog yet.' : 'No beers match that search.'}
        </p>
      ) : (
        <ul className="beer-picker__list" data-testid="beer-picker-list">
          {filtered.map((beer) => (
            <li key={beer.id}>
              <button
                type="button"
                className="beer-picker__option"
                data-testid="beer-picker-option"
                onClick={() => onPick(beer)}
              >
                <span className="beer-picker__option-name">{beer.name}</span>
                {beer.brewery && <span className="beer-picker__option-brewery">{beer.brewery}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
