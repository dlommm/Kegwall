import { useCallback, useEffect, useState } from 'react';
import type { Beer } from '../../../server/db/beers.js';
import { listBeers, deleteBeer } from '../../lib/adminApi';
import { srmToColor } from '../../lib/srm';
import { BeerForm } from './BeerForm';
import { useAdminContext } from './useAdminContext';

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

  useEffect(() => {
    loadBeers();
  }, [loadBeers]);

  const canEdit = me.role === 'editor' || me.role === 'admin';

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
        <h1 className="admin-page-header__title font-display">Beers</h1>
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
      </header>

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

      {status === 'loaded' && beers.length > 0 && (
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
              {canEdit && <th scope="col" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {beers.map((beer) => (
              <tr key={beer.id} data-testid="beers-row">
                <td>
                  {beer.labelImage ? (
                    <img
                      src={beer.labelImage}
                      alt=""
                      className="beers-table__thumb"
                      data-testid="beers-row-thumb"
                    />
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
            ))}
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
