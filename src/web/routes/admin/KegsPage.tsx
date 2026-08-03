import { useEffect, useState } from 'react';
import {
  listKegHistory, listSuppliers, updateKeg, type KegHistoryRow,
} from '../../lib/adminApi';

/** All kegs — on tap now + every past keg — with the ability to edit each one's cost, supplier,
 * deposit, and purchase date AFTER the fact (e.g. adding a supplier to a keg tapped without one).
 * Admin-only: the list carries owner cost. Data: GET /api/kegs/history + PATCH /api/kegs/:id. */

function money(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}
function dollarsToCents(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
function centsToDollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}
/** YYYY-MM-DD for a <input type="date"> from a stored ISO/date string. */
function toDateInput(v: string | null): string {
  return v ? v.slice(0, 10) : '';
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'on_tap', label: 'On tap' },
  { value: 'on_deck', label: 'On deck' },
  { value: 'kicked', label: 'Kicked' },
  { value: 'archived', label: 'Archived' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  on_tap: 'On tap', on_deck: 'On deck', kicked: 'Kicked', archived: 'Archived',
};

interface EditState {
  cost: string;
  deposit: string;
  supplierId: string; // '' = none
  purchasedAt: string;
}

export function KegsPage() {
  const [kegs, setKegs] = useState<KegHistoryRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]['value']>('all');
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<EditState>({ cost: '', deposit: '', supplierId: '', purchasedAt: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [kegsRes, supRes] = await Promise.all([listKegHistory(), listSuppliers()]);
    if (kegsRes.ok) {
      setKegs(kegsRes.data);
      if (supRes.ok) setSuppliers(supRes.data);
      setStatus('loaded');
    } else {
      setStatus('error');
    }
  }
  useEffect(() => { load(); }, []);

  function openEdit(k: KegHistoryRow) {
    setError(null);
    setEditing(k.id);
    setForm({
      cost: centsToDollars(k.costCents),
      deposit: centsToDollars(k.depositCents),
      supplierId: k.supplierId != null ? String(k.supplierId) : '',
      purchasedAt: toDateInput(k.purchasedAt),
    });
  }

  async function save(id: number) {
    setSaving(true);
    setError(null);
    const result = await updateKeg(id, {
      costCents: dollarsToCents(form.cost),
      depositCents: dollarsToCents(form.deposit),
      supplierId: form.supplierId === '' ? null : Number(form.supplierId),
      purchasedAt: form.purchasedAt === '' ? null : form.purchasedAt,
    });
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setEditing(null);
    await load();
  }

  const shown = filter === 'all' ? kegs : kegs.filter((k) => k.status === filter);

  return (
    <section className="admin-page" data-testid="kegs-page">
      <header className="admin-page__header">
        <h1 className="font-display">Kegs</h1>
        <p className="admin-page-quiet">
          Every keg — on tap now and past. Edit a keg&rsquo;s cost, supplier, deposit, or purchase
          date after the fact (e.g. to add a supplier to a keg that was tapped without one).
        </p>
      </header>

      <div className="kegs-toolbar" data-testid="kegs-filter" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <button
            type="button"
            key={f.value}
            className={filter === f.value ? 'kegs-toolbar__btn kegs-toolbar__btn--active' : 'kegs-toolbar__btn'}
            data-testid={`kegs-filter-${f.value}`}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {status === 'loading' && <p className="admin-page-quiet">Loading kegs…</p>}
      {status === 'error' && <p className="admin-page-quiet" data-testid="kegs-error">Couldn&rsquo;t load kegs.</p>}
      {status === 'loaded' && shown.length === 0 && (
        <p className="admin-page-quiet" data-testid="kegs-empty">No kegs to show.</p>
      )}

      {status === 'loaded' && shown.length > 0 && (
        <table className="kegs-table" data-testid="kegs-table">
          <thead>
            <tr>
              <th>Status</th><th>Beer</th><th>Tap</th><th>Size</th><th>Tapped</th>
              <th>Cost</th><th>Supplier</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((k) => (editing === k.id ? (
              <tr key={k.id} data-testid={`keg-row-edit-${k.id}`} className="kegs-table__editing">
                <td>{STATUS_LABEL[k.status] ?? k.status}</td>
                <td>{k.beerName ?? '—'}</td>
                <td>{k.tapNumber != null ? `#${k.tapNumber}${k.tapName ? ` ${k.tapName}` : ''}` : '—'}</td>
                <td>{`${Math.round(k.sizeMl / 1000)} L`}</td>
                <td>{toDateInput(k.dateTapped) || '—'}</td>
                <td>
                  <input
                    type="text" inputMode="decimal" aria-label="Cost (dollars)" placeholder="0.00"
                    data-testid={`keg-edit-cost-${k.id}`}
                    value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                  />
                </td>
                <td>
                  <select
                    aria-label="Supplier" data-testid={`keg-edit-supplier-${k.id}`}
                    value={form.supplierId} onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td className="kegs-table__actions">
                  <label className="kegs-edit__inline">
                    Deposit
                    <input
                      type="text" inputMode="decimal" placeholder="0.00" data-testid={`keg-edit-deposit-${k.id}`}
                      value={form.deposit} onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
                    />
                  </label>
                  <label className="kegs-edit__inline">
                    Purchased
                    <input
                      type="date" data-testid={`keg-edit-purchased-${k.id}`}
                      value={form.purchasedAt} onChange={(e) => setForm((f) => ({ ...f, purchasedAt: e.target.value }))}
                    />
                  </label>
                  <button type="button" data-testid={`keg-save-${k.id}`} disabled={saving} onClick={() => save(k.id)}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" data-testid={`keg-cancel-${k.id}`} onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={k.id} data-testid={`keg-row-${k.id}`}>
                <td>{STATUS_LABEL[k.status] ?? k.status}</td>
                <td>{k.beerName ?? '—'}</td>
                <td>{k.tapNumber != null ? `#${k.tapNumber}${k.tapName ? ` ${k.tapName}` : ''}` : '—'}</td>
                <td>{`${Math.round(k.sizeMl / 1000)} L`}</td>
                <td>{toDateInput(k.dateTapped) || '—'}</td>
                <td data-testid={`keg-cost-${k.id}`}>{money(k.costCents)}</td>
                <td data-testid={`keg-supplier-${k.id}`}>{k.supplierName ?? '—'}</td>
                <td className="kegs-table__actions">
                  <button type="button" data-testid={`keg-edit-${k.id}`} onClick={() => openEdit(k)}>Edit</button>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
      {error && <p className="beer-form__notice" role="alert" data-testid="kegs-save-error">{error}</p>}
    </section>
  );
}
