import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Beer } from '../../../server/db/beers.js';
import type { TapState } from '../../../server/core/state.js';
import {
  listBeers, deleteBeer, listKegs, getLookupConfig, type LookupConfig,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { statusForBeer, beerCatalogSummary, type BeerStatus } from '../../lib/beerCatalog';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { beerColorFor, beerMarkerModel } from '../../wall/wallModel';
import { TapMarker } from '../../wall/TapMarker';
import { BeerForm } from './BeerForm';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import {
  Button, Chips, ConfirmDialog, Drawer, EmptyState, ErrorState, isDarkBeer, Skeleton,
} from './ui';

/** External reference chips in the LOOKUP row that are always available (no config gate). */
const OPEN_BREWERY_DB_URL = 'https://www.openbrewerydb.org';
const BJCP_STYLES_URL = 'https://www.bjcp.org/style/2021/beer/';

type ListStatus = 'loading' | 'loaded' | 'error';
type BeerFilter = 'all' | 'on_tap' | 'library';
type FormState = { mode: 'create' } | { mode: 'edit'; beer: Beer } | null;
interface DeleteState { beer: Beer; error: string | null }

/** `beer.abv` is a plain fraction of a percent... no — like the rest of this schema,
 * it's already "6.5" meaning 6.5%, not a 0-1 fraction (see db/beers.ts / crud.ts,
 * neither converts). Rendered to one decimal place when present. */
function formatAbv(abv: number | null): string {
  return abv == null ? '—' : `${abv.toFixed(1)}%`;
}

function formatIbu(ibu: number | null): string {
  return ibu == null ? '—' : `${Math.round(ibu)} IBU`;
}

/** Where a beer is: "On tap 2 · 72%", "On deck", "In the library". */
function statusText(st: BeerStatus): string {
  if (st.kind === 'on_tap') return `Tap ${st.tapNumber} · ${st.levelPct}% left`;
  if (st.kind === 'on_deck') return 'On deck';
  return 'In the cellar';
}

/** The ledger's groups, in the order a bar thinks of them (Kegwall 2.1 "w-beers"). */
const BEER_GROUPS: { id: string; label: string; kinds: BeerStatus['kind'][] }[] = [
  { id: 'on-tap', label: 'On tap', kinds: ['on_tap'] },
  { id: 'on-deck', label: 'On deck', kinds: ['on_deck'] },
  { id: 'cellar', label: 'In the cellar', kinds: ['none'] },
];

/** "Fifteen beers. Eleven on tap, one waiting in the cellar." */
export function beersHeadline(total: number, onTap: number, onDeck: number): string {
  if (total === 0) return 'No beers yet.';
  const first = total === 1 ? 'One beer.' : `${capitalize(countWord(total))} beers.`;
  const tapPart = onTap === 0 ? 'None on tap' : `${capitalize(countWord(onTap))} on tap`;
  const deckPart = onDeck === 0 ? '' : `, ${countWord(onDeck)} waiting in the cellar`;
  return `${first} ${tapPart}${deckPart}.`;
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
  const [filter, setFilter] = useState<BeerFilter>('all');

  // A reload after a save keeps the list mounted (saves never reset scroll); only the first
  // load shows the skeleton.
  const loadBeers = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
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
  const statusById = useMemo(
    () => new Map(beers.map((b) => [b.id, statusForBeer(b.id, taps, onDeckBeerIds)])),
    [beers, taps, onDeckBeerIds],
  );
  const filteredBeers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return beers.filter((b) => {
      const st = statusById.get(b.id)!;
      if (filter === 'on_tap' && st.kind !== 'on_tap') return false;
      if (filter === 'library' && st.kind === 'on_tap') return false;
      return !q || [b.name, b.brewery, b.style].some((field) => field?.toLowerCase().includes(q));
    });
  }, [beers, query, filter, statusById]);
  const onDeckCount = beers.filter((b) => statusById.get(b.id)?.kind === 'on_deck').length;
  const noColor = beers.filter((b) => b.srm == null).length;

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
      // The editor drawer belonged to the beer that's now gone.
      setFormState(null);
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

  const editing = formState?.mode === 'edit' ? formState.beer : null;

  return (
    <PageTemplate
      testId="admin-beers-page"
      title={status === 'loaded' ? beersHeadline(summary.total, summary.onTap, onDeckCount) : 'Beers'}
      sub={status === 'loaded' && beers.length > 0 ? (
        <>
          <span data-testid="beers-summary">
            {summary.missingArt === 0
              ? 'Every beer has label art.'
              : `${summary.missingArt} of ${summary.total} have no label art, so their markers use the beer’s color and initials.`}
          </span>
          {noColor > 0 && ` ${noColor === 1 ? 'One has' : `${capitalize(countWord(noColor))} have`} no color set yet.`}
        </>
      ) : undefined}
      actions={canEdit && (
        <Button variant="primary" data-testid="beers-add-button" onClick={() => setFormState({ mode: 'create' })}>
          Add a beer
        </Button>
      )}
      drawer={(
        <>
          {formState && canEdit && (
            <Drawer
              open
              onOpenChange={(open) => { if (!open) setFormState(null); }}
              size="wide"
              title={editing ? editing.name : 'Add a beer'}
              description={editing ? statusText(statusById.get(editing.id) ?? { kind: 'none' }) : undefined}
              footer={editing ? (
                <Button variant="danger" data-testid="beers-row-delete" onClick={() => setDeleteState({ beer: editing, error: null })}>
                  Delete beer
                </Button>
              ) : undefined}
            >
              <BeerForm
                key={editing ? editing.id : 'create'}
                mode={formState.mode}
                beer={editing}
                onSaved={handleSaved}
                onCancel={() => setFormState(null)}
              />
            </Drawer>
          )}
          <ConfirmDialog
            open={deleteState !== null}
            onOpenChange={(open) => { if (!open) setDeleteState(null); }}
            title={deleteState ? `Delete ${deleteState.beer.name}?` : ''}
            confirmLabel="Delete beer"
            busyLabel="Deleting…"
            busy={deleting}
            error={deleteState?.error}
            onConfirm={handleConfirmDelete}
            testId="beers-delete-confirm"
            confirmTestId="beers-delete-confirm-button"
            cancelTestId="beers-delete-cancel-button"
            errorTestId="beers-delete-error"
          >
            {deleteState && (
              <p>
                This will permanently delete &ldquo;{deleteState.beer.name}&rdquo; from the catalog.
                This can&rsquo;t be undone.
              </p>
            )}
          </ConfirmDialog>
        </>
      )}
    >
      {status === 'loaded' && beers.length > 0 && (
        <div className="adm-toolbar">
          <input
            type="search"
            className="adm-input beers-v2__search"
            data-testid="beers-search"
            placeholder="Search beers, breweries, styles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search beers"
          />
          <Chips<BeerFilter>
            label="Show beers"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'on_tap', label: 'On tap' },
              { value: 'library', label: 'In the cellar' },
            ]}
          />
        </div>
      )}

      {status === 'loading' && <div data-testid="beers-loading"><Skeleton height={120} /></div>}
      {status === 'error' && (
        <div data-testid="beers-error">
          <ErrorState title="Couldn’t load beers." onRetry={loadBeers}>Reload to try again.</ErrorState>
        </div>
      )}
      {status === 'loaded' && beers.length === 0 && (
        <div data-testid="beers-empty">
          <EmptyState title="No beers yet.">Add a beer, or tap a keg and add one there.</EmptyState>
        </div>
      )}

      {status === 'loaded' && beers.length > 0 && filteredBeers.length === 0 && (
        <p className="adm-note" data-testid="beers-no-matches">
          {query.trim() ? `No beers match “${query.trim()}”.` : 'No beers here.'}
        </p>
      )}

      {status === 'loaded' && filteredBeers.length > 0 && (
        <div className="beers-v2" data-testid="beers-table">
          {BEER_GROUPS.map((group) => {
            const inGroup = filteredBeers.filter((b) => group.kinds.includes(statusById.get(b.id)!.kind));
            if (inGroup.length === 0) return null;
            return (
              <section key={group.id} className="beers-v2__group" aria-label={group.label} data-testid={`beers-group-${group.id}`}>
                <h2 className="beers-v2__group-title">
                  {group.label}
                  <span>{inGroup.length}</span>
                </h2>
                <ul className="beers-v2__rows">
                  {inGroup.map((beer) => {
                    const st = statusById.get(beer.id)!;
                    const color = beerColorFor(beer.srm);
                    return (
                      <li
                        key={beer.id}
                        className="beers-v2__row"
                        data-testid="beers-row"
                        data-no-color={beer.srm == null || undefined}
                        data-dark-beer={(beer.srm != null && isDarkBeer(color)) || undefined}
                        style={{ '--srm': color } as CSSProperties}
                      >
                        {beer.labelImage
                          ? <img src={beer.labelImage} alt="" className="beers-v2__art" data-testid="beers-row-thumb" />
                          : <TapMarker model={beerMarkerModel(beer)} size={48} showNumber={false} />}
                        <div className="beers-v2__text">
                          <div className="beers-v2__name adm-ell">{beer.name}</div>
                          <div className="adm-sub adm-ell">
                            <span
                              className="beers-v2__dot"
                              data-testid="beers-row-srm-chip"
                              style={{ backgroundColor: color }}
                              title={beer.srm != null ? `SRM ${beer.srm}` : 'SRM unknown'}
                            />
                            {[beer.style, beer.brewery].filter(Boolean).join(' · ') || '—'}
                            {beer.srm == null && <span className="beers-v2__nocolor"> · no color set</span>}
                          </div>
                        </div>
                        <div className="beers-v2__figures adm-num-cell">{`${formatAbv(beer.abv)} · ${formatIbu(beer.ibu)}`}</div>
                        <div
                          className={st.kind === 'on_tap' ? (st.low ? 'beers-v2__where adm-warn-text' : 'beers-v2__where')
                            : st.kind === 'on_deck' ? 'beers-v2__where beers-v2__where--deck' : 'beers-v2__where adm-sub'}
                          data-testid="beers-row-status"
                        >
                          {statusText(st)}
                        </div>
                        {canEdit && (
                          <div className="beers-v2__actions">
                            {!beer.labelImage && (
                              <Button
                                variant="quiet"
                                data-testid="beers-row-add-art"
                                onClick={() => setFormState({ mode: 'edit', beer })}
                              >
                                Add art
                              </Button>
                            )}
                            <Button variant="secondary" data-testid="beers-row-edit" onClick={() => setFormState({ mode: 'edit', beer })}>
                              Edit
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {status === 'loaded' && beers.length > 0 && (
        <p className="beers-v2__lookup adm-sub" data-testid="beers-lookup-row">
          {'Look things up: '}
          <a href={OPEN_BREWERY_DB_URL} target="_blank" rel="noreferrer">Open Brewery DB</a>
          {' · '}
          <a href={BJCP_STYLES_URL} target="_blank" rel="noreferrer">BJCP styles</a>
          {' · '}
          <span
            className={lookupConfig?.catalogBeerConfigured ? undefined : 'beers-v2__dashed'}
            data-testid="beers-chip-catalog"
          >
            {lookupConfig?.catalogBeerConfigured ? 'catalog.beer ✓' : 'catalog.beer — add API key in Settings'}
          </span>
          {' · '}
          <span data-testid="beers-chip-autoimport">
            {`Auto-import from Kegtron: ${lookupConfig?.autoImportBeers ? 'on' : 'off'}`}
          </span>
        </p>
      )}
    </PageTemplate>
  );
}
