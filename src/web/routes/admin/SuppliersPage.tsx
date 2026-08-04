import { useCallback, useEffect, useState } from 'react';
import {
  listSuppliers, getSupplierStats, getSupplierPriceBook,
  createSupplier, updateSupplier, deleteSupplier,
  type Supplier, type SupplierInput, type SupplierStats, type PriceBookEntry,
} from '../../lib/adminApi';
import { formatWholeVolume } from '../../lib/lookData';
import { hoursRuns, isOpenAt } from '../../lib/supplierHours';
import { SupplierHoursEditor } from './SupplierHoursEditor';
import { useAdminContext } from './useAdminContext';

/** Owner-cost cents → "$12.00". Admin-only surface, so showing real dollars is fine here. */
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** First letters of a supplier name, for the monogram tile (max two). */
function monogram(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

const EMPTY_FORM: SupplierInput = {
  name: '', contactName: '', phone: '', email: '', address: '', hours: null, deliveryNotes: '', notes: '',
};

/** The text-input fields of the supplier form — `hours` is structured and gets its own
 *  weekly grid editor (see SupplierHoursEditor), so it isn't in this list. */
const TEXT_FIELDS = [
  ['name', 'Name'], ['contactName', 'Contact person'], ['phone', 'Phone'], ['email', 'Email'],
  ['address', 'Address'], ['deliveryNotes', 'Delivery day / notes'],
] as const;

type FormState = { mode: 'create' } | { mode: 'edit'; supplier: Supplier } | null;

/**
 * A supplier card's opening hours: consecutive days sharing a range collapse into one
 * line ("Mon–Fri 9 AM–5 PM"), with a live open/closed badge. The badge is omitted for a
 * legacy note-only supplier — there's no structured week to judge it against.
 */
function SupplierHours({ hours }: { hours: Supplier['hours'] }) {
  const runs = hoursRuns(hours);
  const open = isOpenAt(hours, new Date());
  if (runs.length === 0 && !hours?.note) return null;
  return (
    <div className="supplier-card__hours" data-testid="supplier-card-hours">
      <div className="supplier-card__hours-head">
        <span className="supplier-card__pricebook-label">HOURS</span>
        {open != null && (
          <span
            className={`supplier-badge supplier-badge--${open ? 'open' : 'closed'}`}
            data-testid="supplier-open-badge"
          >
            {open ? 'OPEN NOW' : 'CLOSED'}
          </span>
        )}
      </div>
      {runs.length > 0 && (
        <ul className="supplier-card__hours-list">
          {runs.map((run) => (
            <li key={run.days}>
              <span className="supplier-card__hours-days">{run.days}</span>
              <span className="font-tabular">{run.hours}</span>
            </li>
          ))}
        </ul>
      )}
      {hours?.note && <p className="supplier-card__hours-note">{hours.note}</p>}
    </div>
  );
}

/**
 * `/admin/suppliers` (redesign 4l): supplier directory + DERIVED price book (from keg
 * purchase history — never hand-entered). Admin-only route: it surfaces owner cost (last-paid
 * prices, YTD spend), which the hard requirement keeps off every public surface.
 */
export function SuppliersPage() {
  const { units } = useAdminContext();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stats, setStats] = useState<SupplierStats | null>(null);
  const [priceBooks, setPriceBooks] = useState<Record<number, PriceBookEntry[]>>({});
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [formState, setFormState] = useState<FormState>(null);
  const [form, setForm] = useState<SupplierInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const load = useCallback(() => {
    setStatus('loading');
    listSuppliers().then(async (result) => {
      if (!result.ok) { setStatus('error'); return; }
      setSuppliers(result.data);
      setStatus('loaded');
      const books = await Promise.all(result.data.map((s) => getSupplierPriceBook(s.id)));
      const map: Record<number, PriceBookEntry[]> = {};
      result.data.forEach((s, i) => {
        const book = books[i];
        map[s.id] = book && book.ok ? book.data : [];
      });
      setPriceBooks(map);
    });
    getSupplierStats().then((result) => {
      if (result.ok) setStats(result.data);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormState({ mode: 'create' });
  }

  function openEdit(supplier: Supplier) {
    setForm({
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      hours: supplier.hours,
      deliveryNotes: supplier.deliveryNotes ?? '',
      notes: supplier.notes ?? '',
    });
    setFormState({ mode: 'edit', supplier });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formState || !form.name.trim()) return;
    setSaving(true);
    const result = formState.mode === 'create'
      ? await createSupplier(form)
      : await updateSupplier(formState.supplier.id, form);
    setSaving(false);
    if (result.ok) {
      setFormState(null);
      load();
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteSupplier(deleteTarget.id);
    if (result.ok) {
      setDeleteTarget(null);
      load();
    }
  }

  return (
    <section data-testid="admin-suppliers-page">
      <header className="admin-page-header">
        <div className="admin-page-header__lead">
          <h1 className="admin-page-header__title font-display">Suppliers</h1>
          {stats && (
            <span className="beers-summary font-tabular" data-testid="suppliers-summary">
              {`${stats.supplierCount} suppliers · ${stats.kegsPurchased} kegs purchased · ${money(stats.ytdSpendCents)} YTD`}
            </span>
          )}
        </div>
        {!formState && (
          <button type="button" className="admin-page-header__action" data-testid="suppliers-add-button" onClick={openCreate}>
            Add supplier
          </button>
        )}
      </header>

      {formState && (
        <form className="supplier-form" data-testid="supplier-form" onSubmit={handleSave}>
          <div className="supplier-form__grid">
            {TEXT_FIELDS.map(([field, label]) => (
              <label key={field} className="supplier-form__field">
                <span>{label}</span>
                <input
                  type="text"
                  data-testid={`supplier-form-${field}`}
                  value={(form[field] as string) ?? ''}
                  onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                  required={field === 'name'}
                />
              </label>
            ))}
          </div>
          <SupplierHoursEditor
            value={form.hours ?? null}
            onChange={(hours) => setForm((f) => ({ ...f, hours }))}
          />
          <div className="admin-confirm__actions">
            <button type="submit" data-testid="supplier-form-save" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : formState.mode === 'create' ? 'Add supplier' : 'Save supplier'}
            </button>
            <button type="button" data-testid="supplier-form-cancel" onClick={() => setFormState(null)}>Cancel</button>
          </div>
        </form>
      )}

      {status === 'loading' && <p className="admin-page-quiet" data-testid="suppliers-loading">Loading…</p>}
      {status === 'error' && <p className="admin-page-quiet" role="alert" data-testid="suppliers-error">Couldn’t load suppliers.</p>}
      {status === 'loaded' && suppliers.length === 0 && !formState && (
        <p className="admin-page-quiet" data-testid="suppliers-empty">No suppliers yet — add one to start tracking keg costs.</p>
      )}

      <div className="suppliers-grid">
        {suppliers.map((supplier) => {
          const book = priceBooks[supplier.id] ?? [];
          const bestCount = book.filter((e) => e.isBestKnown).length;
          const onlyCount = book.filter((e) => e.bestElsewhereCents == null).length;
          return (
            <section key={supplier.id} className="supplier-card" data-testid="supplier-card">
              <div className="supplier-card__head">
                <span className="supplier-card__monogram" aria-hidden="true">{monogram(supplier.name)}</span>
                <div className="supplier-card__title">
                  <h2 className="supplier-card__name font-display">{supplier.name}</h2>
                  <div className="supplier-card__badges">
                    {bestCount > 0 && (
                      <span className="supplier-badge supplier-badge--best" data-testid="supplier-badge-best">{`BEST PRICE ×${bestCount}`}</span>
                    )}
                    {onlyCount > 0 && (
                      <span className="supplier-badge supplier-badge--only" data-testid="supplier-badge-only">{`ONLY SOURCE ×${onlyCount}`}</span>
                    )}
                  </div>
                </div>
              </div>

              <dl className="supplier-card__contact">
                {supplier.contactName && (<><dt>Contact</dt><dd>{supplier.contactName}</dd></>)}
                {supplier.phone && (<><dt>Phone</dt><dd>{supplier.phone}</dd></>)}
                {supplier.email && (<><dt>Email</dt><dd>{supplier.email}</dd></>)}
                {supplier.address && (<><dt>Address</dt><dd>{supplier.address}</dd></>)}
                {supplier.deliveryNotes && (<><dt>Delivery</dt><dd>{supplier.deliveryNotes}</dd></>)}
              </dl>

              <SupplierHours hours={supplier.hours} />

              <div className="supplier-card__pricebook" data-testid="supplier-pricebook">
                <span className="supplier-card__pricebook-label">PRICE BOOK</span>
                {book.length === 0 ? (
                  <p className="admin-page-quiet">No purchases logged yet.</p>
                ) : (
                  <table className="admin-table supplier-pricebook-table">
                    <tbody>
                      {book.map((entry) => (
                        <tr key={`${entry.beerId}-${entry.sizeMl}`} data-testid="supplier-pricebook-row">
                          <td>{entry.beerName}</td>
                          <td className="font-tabular">{formatWholeVolume(entry.sizeMl, units)}</td>
                          <td className={`font-tabular${entry.isBestKnown ? ' supplier-price--best' : ''}`}>
                            {entry.isBestKnown ? '★ ' : ''}
                            {money(entry.lastPaidCents)}
                          </td>
                          <td className="supplier-price__compare">
                            {entry.bestElsewhereCents != null
                              ? `${entry.bestElsewhereSupplierName}: ${money(entry.bestElsewhereCents)}`
                              : 'no other source'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="supplier-card__actions">
                <button type="button" data-testid="supplier-edit" onClick={() => openEdit(supplier)}>Edit</button>
                <button type="button" data-testid="supplier-delete" onClick={() => setDeleteTarget(supplier)}>Delete</button>
              </div>
            </section>
          );
        })}
      </div>

      {deleteTarget && (
        <div className="admin-confirm__backdrop" data-testid="supplier-delete-confirm" onClick={() => setDeleteTarget(null)}>
          <div className="admin-confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display">Delete supplier</h3>
            <p>
              {`Delete “${deleteTarget.name}”? Kegs bought from them keep their recorded cost — only the
              supplier link is cleared.`}
            </p>
            <div className="admin-confirm__actions">
              <button type="button" data-testid="supplier-delete-confirm-button" onClick={handleDelete}>Delete supplier</button>
              <button type="button" data-testid="supplier-delete-cancel-button" onClick={() => setDeleteTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
