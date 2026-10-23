import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  listSuppliers, getSupplierStats, getSupplierPriceBook,
  createSupplier, updateSupplier, deleteSupplier,
  type Supplier, type SupplierInput, type SupplierStats, type PriceBookEntry,
} from '../../lib/adminApi';
import { formatWholeVolume } from '../../lib/lookData';
import { money, wholeMoney } from '../../lib/adminFormat';
import { DAY_KEYS, hoursRuns, isOpenAt } from '../../lib/supplierHours';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { SupplierHoursEditor } from './SupplierHoursEditor';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Skeleton,
} from './ui';


const EMPTY_FORM: SupplierInput = {
  name: '', contactName: '', phone: '', email: '', address: '', hours: null, deliveryNotes: '', notes: '',
};

/** The text-input fields of the supplier form — `hours` is structured and gets its own
 *  weekly grid editor (see SupplierHoursEditor), so it isn't in this list. */
const TEXT_FIELDS = [
  ['name', 'Name'], ['contactName', 'Contact person'], ['phone', 'Phone'], ['email', 'Email'],
  ['address', 'Address'], ['deliveryNotes', 'Delivery day / notes'],
] as const;

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type FormState = { mode: 'create' } | { mode: 'edit'; supplier: Supplier } | null;

/**
 * A supplier's opening hours: a week of day letters (open days in ink), the runs in words
 * ("Mon–Fri 9 AM–5 PM") and whether they're open right now. The open/closed state is
 * omitted for a legacy note-only supplier — there's no structured week to judge it against.
 */
function SupplierHours({ hours }: { hours: Supplier['hours'] }) {
  const runs = hoursRuns(hours);
  const open = isOpenAt(hours, new Date());
  if (runs.length === 0 && !hours?.note) return null;
  return (
    <div className="supplier-v2__hours" data-testid="supplier-card-hours">
      {runs.length > 0 && hours && (
        <div className="supplier-v2__week" aria-hidden="true">
          {DAY_KEYS.map((k, i) => (
            <span key={k} className={hours.days[k] ? 'is-open' : undefined}>{DAY_LETTERS[i]}</span>
          ))}
        </div>
      )}
      {runs.length > 0 && (
        <ul className="supplier-v2__runs">
          {runs.map((run) => (
            <li key={run.days}>
              <span>{run.days}</span>
              <span className="adm-num-cell">{run.hours}</span>
            </li>
          ))}
        </ul>
      )}
      {open != null && (
        <span className={open ? 'adm-ok-text' : 'adm-sub'} data-testid="supplier-open-badge">
          {open ? 'Open now' : 'Closed now'}
        </span>
      )}
      {hours?.note && <p className="adm-sub supplier-v2__note">{hours.note}</p>}
    </div>
  );
}

/** "Three suppliers. You've bought 11 kegs from them this year for $1,684." */
function suppliersHeadline(count: number, stats: SupplierStats | null): string {
  if (count === 0) return 'No suppliers yet.';
  const first = count === 1 ? 'One supplier.' : `${capitalize(countWord(count))} suppliers.`;
  if (!stats || stats.kegsPurchased === 0) return first;
  const kegs = stats.kegsPurchased === 1 ? 'one keg' : `${countWord(stats.kegsPurchased)} kegs`;
  return `${first} You’ve logged ${kegs} from them, ${wholeMoney(stats.ytdSpendCents)} this year.`;
}

/**
 * `/admin/suppliers` (Kegwall V2 M8; redesign 4l): who you buy from, when they're open, and
 * the DERIVED price book (from keg purchase history — never hand-entered). Adding and editing
 * happen in a drawer. Admin-only route: it surfaces owner cost (last-paid prices, YTD spend),
 * which the hard requirement keeps off every public surface.
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
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
    setSaveError(null);
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
    setSaveError(null);
    setFormState({ mode: 'edit', supplier });
  }

  async function handleSave(e: FormEvent) {
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
    } else {
      setSaveError(result.message);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteSupplier(deleteTarget.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteTarget(null);
      load();
    } else {
      setDeleteError(result.message);
    }
  }

  return (
    <PageTemplate
      testId="admin-suppliers-page"
      title={status === 'loaded' ? suppliersHeadline(suppliers.length, stats) : 'Suppliers'}
      sub={(
        <>
          {stats && stats.supplierCount > 0 && (
            <span data-testid="suppliers-summary">
              {`${stats.supplierCount} suppliers · ${stats.kegsPurchased} kegs purchased · ${wholeMoney(stats.ytdSpendCents)} this year. `}
            </span>
          )}
          Prices come from what you paid for each keg, so the price book keeps itself current.
        </>
      )}
      actions={(
        <Button variant="primary" data-testid="suppliers-add-button" onClick={openCreate}>Add a supplier</Button>
      )}
      drawer={(
        <>
          {formState && (
            <Drawer
              open
              onOpenChange={(open) => { if (!open) setFormState(null); }}
              size="wide"
              title={formState.mode === 'create' ? 'Add a supplier' : `Edit ${formState.supplier.name}`}
            >
              <form className="adm-form" data-testid="supplier-form" onSubmit={handleSave}>
                <div className="adm-grid-2">
                  {TEXT_FIELDS.map(([field, label]) => (
                    <label key={field} className="admin-field">
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
                {saveError && <p className="adm-danger-text" role="alert">{saveError}</p>}
                <div className="adm-form__actions">
                  <Button type="submit" variant="primary" data-testid="supplier-form-save" disabled={saving || !form.name.trim()}>
                    {saving ? 'Saving…' : formState.mode === 'create' ? 'Add supplier' : 'Save supplier'}
                  </Button>
                  <Button variant="quiet" data-testid="supplier-form-cancel" onClick={() => setFormState(null)}>Cancel</Button>
                </div>
              </form>
            </Drawer>
          )}
          <ConfirmDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null); } }}
            title={deleteTarget ? `Delete ${deleteTarget.name}?` : ''}
            confirmLabel="Delete supplier"
            busyLabel="Deleting…"
            busy={deleting}
            error={deleteError}
            onConfirm={handleDelete}
            testId="supplier-delete-confirm"
            confirmTestId="supplier-delete-confirm-button"
            cancelTestId="supplier-delete-cancel-button"
          >
            <p>Kegs bought from them keep their recorded cost. Only the supplier link is cleared.</p>
          </ConfirmDialog>
        </>
      )}
    >
      <p className="adm-note">Only owners see costs. Guests and staff never get them on any screen.</p>
      {status === 'loading' && <div data-testid="suppliers-loading"><Skeleton height={120} /></div>}
      {status === 'error' && (
        <div data-testid="suppliers-error"><ErrorState title="Couldn’t load suppliers." onRetry={load} /></div>
      )}
      {status === 'loaded' && suppliers.length === 0 && (
        <div data-testid="suppliers-empty">
          <EmptyState title="No suppliers yet.">Add one to start tracking what each keg costs.</EmptyState>
        </div>
      )}

      <ul className="supplier-v2__list">
        {suppliers.map((supplier) => {
          const book = priceBooks[supplier.id] ?? [];
          const bestCount = book.filter((e) => e.isBestKnown).length;
          const onlyCount = book.filter((e) => e.bestElsewhereCents == null).length;
          const contact = [supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(' · ');
          return (
            <li key={supplier.id} className="supplier-v2" data-testid="supplier-card">
              <div className="supplier-v2__who">
                <h2 className="adm-name">{supplier.name}</h2>
                {(bestCount > 0 || onlyCount > 0) && (
                  <p className="supplier-v2__flags">
                    {bestCount > 0 && <span data-testid="supplier-badge-best">{`Best price on ${bestCount}`}</span>}
                    {onlyCount > 0 && <span data-testid="supplier-badge-only">{`Only source for ${onlyCount}`}</span>}
                  </p>
                )}
                {contact && <p className="adm-sub">{contact}</p>}
                {supplier.address && <p className="adm-sub">{supplier.address}</p>}
                {supplier.deliveryNotes && <p className="adm-sub">{`Delivery: ${supplier.deliveryNotes}`}</p>}
                <SupplierHours hours={supplier.hours} />
                <div className="supplier-v2__actions">
                  <Button data-testid="supplier-edit" onClick={() => openEdit(supplier)}>Edit</Button>
                  <Button variant="quiet" data-testid="supplier-delete" onClick={() => { setDeleteError(null); setDeleteTarget(supplier); }}>Delete</Button>
                </div>
              </div>
              <div className="supplier-v2__book" data-testid="supplier-pricebook">
                <h3>Price book</h3>
                {book.length === 0 ? (
                  <p className="adm-sub">No purchases logged yet.</p>
                ) : (
                  <table className="adm-table">
                    <tbody>
                      {book.map((entry) => (
                        <tr key={`${entry.beerId}-${entry.sizeMl}`} data-testid="supplier-pricebook-row">
                          <td>{entry.beerName}</td>
                          <td className="adm-num">{formatWholeVolume(entry.sizeMl, units)}</td>
                          <td className={entry.isBestKnown ? 'adm-num adm-ok-text' : 'adm-num'}>
                            {entry.isBestKnown ? '★ ' : ''}
                            {money(entry.lastPaidCents)}
                          </td>
                          <td className="adm-sub">
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
            </li>
          );
        })}
      </ul>
    </PageTemplate>
  );
}
