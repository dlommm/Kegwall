import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Beer } from '../../../server/db/beers.js';
import type { TapState } from '../../../server/core/state.js';
import {
  listBeers, deleteBeer, listKegs, getLookupConfig, type LookupConfig,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { srmToColor } from '../../lib/srm';
import { statusForBeer, beerCatalogSummary } from '../../lib/beerCatalog';
import { BeerForm } from './BeerForm';
import { useAdminContext } from './useAdminContext';

/** External reference chips in the LOOKUP row that are always available (no config gate). */
const OPEN_BREWERY_DB_URL = 'https://www.openbrewerydb.org';
const BJCP_STYLES_URL = 'https://www.bjcp.org/style/2021/beer/';

type ListStatus = 'loading' | 'loaded' | 'error';
type FormState = { mode: 'create' } | { mode: 'edit'; beer: Beer } | null;
interface DeleteState { beer: Beer; error: string | null }

/** `beer.abv` is a plain fraction of a percent... no — like the rest of this schema,
 * it's already "6.5" meaning 6.5%, not a 0-1 fraction (see db/beers.ts / crud.ts,
 * neither converts). Rendered to one decimal place when present. */
function formatAbv(abv: number | null): string {
  return abv == null ? '—' : `${abv.toFixed(1)}%`;
}

function formatIbu(ibu: number | null): string {
  return ibu == null ? '—' : String(Math.round(ibu));
}

/**
 * `/admin/beers` (Task 4): the beer catalog table plus create/edit form, with brewery and
 * style autocomplete (both inside `BeerForm`). A viewer sees a read-only table — no "Add
 * beer" button, no per-row Edit/Delete controls, and `BeerForm` is never mounted for them
 * at all (not just hidden), matching the server's own `editor`-role gate on every
 * beers-mutating endpoint.
 */
export function BeersPage() {
  const { me } = useAdminContext();
  const [beers, setBeers] = useState<Beer[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [taps, setTaps] = useState<TapState[]>([]);
  const [onDeckBeerIds, setOnDeckBeerIds] = useState<Set<number>>(new Set());
  const [lookupConfig, setLookupConfig] = useState<LookupConfig | null>(null);
  const [query, setQuery] = useState('');

  const loadBeers = useCallback(() => {
    setStatus('loading');
    listBeers().then((result) => {
      if (result.ok) {
        setBeers(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, []);

  // Live status context: which beers are on tap (menu snapshot) and which are queued on deck
  // (on_deck kegs). Read-only, load-once — the count summary + STATUS column read from these.
  const loadStatusContext = useCallback(() => {
    getMenu().then((result) => {
      if (result.ok) setTaps(result.data.taps);
    });
    listKegs().then((result) => {
      if (result.ok) {
        setOnDeckBeerIds(new Set(result.data.filter((k) => k.status === 'on_deck').map((k) => k.beerId)));
      }
    });
  }, []);

  useEffect(() => {
    loadBeers();
    loadStatusContext();
    getLookupConfig().then((result) => {
      if (result.ok) setLookupConfig(result.data);
    });
  }, [loadBeers, loadStatusContext]);

  const canEdit = me.role === 'editor' || me.role === 'admin';

  const summary = useMemo(() => beerCatalogSummary(beers, taps), [beers, taps]);
  const filteredBeers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return beers;
    return beers.filter((b) => [b.name, b.brewery, b.style]
      .some((field) => field?.toLowerCase().includes(q)));
  }, [beers, query]);

  function handleSaved() {
    setFormState(null);
    loadBeers();
  }

  async function handleConfirmDelete() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deleteBeer(deleteState.beer.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteState(null);
      loadBeers();
      return;
    }
    if (result.status === 409) {
      setDeleteState({
        ...deleteState,
        error: `${deleteState.beer.name} is in use by a keg — remove or archive that keg first.`,
      });
      return;
    }
    setDeleteState({ ...deleteState, error: 'Something went wrong. Try again.' });
  }

  return (
    <section data-testid="admin-beers-page">
      <header className="admin-page-header">
        <div className="admin-page-header__lead">
          <h1 className="admin-page-header__title font-display">Beers</h1>
          {status === 'loaded' && beers.length > 0 && (
            <span className="beers-summary font-tabular" data-testid="beers-summary">
              {`${summary.total} total · ${summary.onTap} on tap · ${summary.missingArt} missing label art`}
            </span>
          )}
        </div>
        <div className="beers-header__controls">
          {beers.length > 0 && (
            <input
              type="search"
              className="beers-search"
              data-testid="beers-search"
              placeholder="Search beers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search beers"
            />
          )}
          {canEdit && !formState && (
            <button
              type="button"
              className="admin-page-header__action"
              data-testid="beers-add-button"
              onClick={() => setFormState({ mode: 'create' })}
            >
              Add beer
            </button>
          )}
        </div>
      </header>

      {status === 'loaded' && beers.length > 0 && (
        <div className="beers-lookup" data-testid="beers-lookup-row">
          <a className="beers-chip" href={OPEN_BREWERY_DB_URL} target="_blank" rel="noreferrer">
            Open Brewery DB
          </a>
          <a className="beers-chip" href={BJCP_STYLES_URL} target="_blank" rel="noreferrer">
            BJCP styles
          </a>
          <span
            className={`beers-chip${lookupConfig?.catalogBeerConfigured ? '' : ' beers-chip--dashed'}`}
            data-testid="beers-chip-catalog"
          >
            {lookupConfig?.catalogBeerConfigured ? 'catalog.beer ✓' : 'catalog.beer — add API key'}
          </span>
          <span
            className={`beers-chip${lookupConfig?.autoImportBeers ? ' beers-chip--on' : ''}`}
            data-testid="beers-chip-autoimport"
          >
            {`Auto-import from Kegtron: ${lookupConfig?.autoImportBeers ? 'on' : 'off'}`}
          </span>
        </div>
      )}

      {formState && canEdit && (
        <BeerForm
          key={formState.mode === 'edit' ? formState.beer.id : 'create'}
          mode={formState.mode}
          beer={formState.mode === 'edit' ? formState.beer : null}
          onSaved={handleSaved}
          onCancel={() => setFormState(null)}
        />
      )}

      {status === 'loading' && <p className="admin-page-quiet" data-testid="beers-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="beers-error">
          Couldn&rsquo;t load beers. Reload to try again.
        </p>
      )}
      {status === 'loaded' && beers.length === 0 && (
        <p className="admin-page-quiet" data-testid="beers-empty">No beers yet.</p>
      )}

      {status === 'loaded' && beers.length > 0 && filteredBeers.length === 0 && (
        <p className="admin-page-quiet" data-testid="beers-no-matches">
          {`No beers match “${query.trim()}”.`}
        </p>
      )}

      {status === 'loaded' && filteredBeers.length > 0 && (
        <table className="admin-table" data-testid="beers-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Label" />
              <th scope="col">Name</th>
              <th scope="col">Brewery</th>
              <th scope="col">Style</th>
              <th scope="col">ABV</th>
              <th scope="col">IBU</th>
              <th scope="col">SRM</th>
              <th scope="col">Status</th>
              {canEdit && <th scope="col" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {filteredBeers.map((beer) => {
              const beerStatus = statusForBeer(beer.id, taps, onDeckBeerIds);
              return (
                <tr key={beer.id} data-testid="beers-row">
                  <td>
                    {beer.labelImage ? (
                      <img
                        src={beer.labelImage}
                        alt=""
                        className="beers-table__thumb"
                        data-testid="beers-row-thumb"
                      />
                    ) : canEdit ? (
                      // Dashed "add art" chip — jumps to the edit form where the label upload
                      // lives (feeds the Phase 1 label-art feature).
                      <button
                        type="button"
                        className="beers-table__thumb beers-table__thumb--add"
                        data-testid="beers-row-add-art"
                        title="Add label art"
                        onClick={() => setFormState({ mode: 'edit', beer })}
                      >
                        + art
                      </button>
                    ) : (
                      <span className="beers-table__thumb beers-table__thumb--empty" aria-hidden="true" />
                    )}
                  </td>
                  <td className="font-body">{beer.name}</td>
                  <td>{beer.brewery ?? '—'}</td>
                  <td>{beer.style ?? '—'}</td>
                  <td className="font-tabular">{formatAbv(beer.abv)}</td>
                  <td className="font-tabular">{formatIbu(beer.ibu)}</td>
                  <td>
                    <span
                      className="beers-table__srm-chip"
                      data-testid="beers-row-srm-chip"
                      style={{ backgroundColor: srmToColor(beer.srm).liquid }}
                      title={beer.srm != null ? `SRM ${beer.srm}` : 'SRM unknown'}
                    />
                  </td>
                  <td>
                    {beerStatus.kind === 'on_tap' ? (
                      <span
                        className={`beers-status beers-status--${beerStatus.low ? 'low' : 'on-tap'}`}
                        data-testid="beers-row-status"
                      >
                        {`TAP ${beerStatus.tapNumber} · ${beerStatus.levelPct}%`}
                      </span>
                    ) : beerStatus.kind === 'on_deck' ? (
                      <span className="beers-status beers-status--on-deck" data-testid="beers-row-status">
                        ON DECK
                      </span>
                    ) : (
                      <span className="beers-status beers-status--none" data-testid="beers-row-status">—</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="beers-table__actions">
                      <button
                        type="button"
                        data-testid="beers-row-edit"
                        onClick={() => setFormState({ mode: 'edit', beer })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        data-testid="beers-row-delete"
                        onClick={() => setDeleteState({ beer, error: null })}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {deleteState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="beers-delete-confirm"
          onClick={() => !deleting && setDeleteState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="beers-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="beers-delete-title" className="font-display">Delete beer</h3>
            <p>
              This will permanently delete &ldquo;{deleteState.beer.name}&rdquo; from the catalog.
              This can&rsquo;t be undone.
            </p>
            {deleteState.error && (
              <p role="alert" data-testid="beers-delete-error">{deleteState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="beers-delete-confirm-button"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Deleting…' : 'Delete beer'}
              </button>
              <button
                type="button"
                data-testid="beers-delete-cancel-button"
                disabled={deleting}
                onClick={() => setDeleteState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
