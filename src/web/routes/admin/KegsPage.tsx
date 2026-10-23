import { useEffect, useState } from 'react';
import {
  listKegHistory, listSuppliers, updateKeg, type KegHistoryRow,
} from '../../lib/adminApi';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { PageTemplate } from './PageTemplate';
import {
  Button, Chips, Drawer, EmptyState, ErrorState, SelectField, Skeleton, Table,
} from './ui';

/** All kegs — on tap now + every past keg — with the ability to edit each one's cost, supplier,
 * deposit, and purchase date AFTER the fact (e.g. adding a supplier to a keg tapped without one).
 * Admin-only: the list carries owner cost. Data: GET /api/kegs/history + PATCH /api/kegs/:id. */

const ML_PER_PINT = 473.176;

function money(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}
function wholeMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
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
function shortDate(v: string): string {
  return new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** Owner cost per US pint of the keg's starting volume, or null without a cost. */
function perPintCents(k: KegHistoryRow): number | null {
  if (k.costCents == null || k.volStartMl <= 0) return null;
  return k.costCents / (k.volStartMl / ML_PER_PINT);
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'on_tap', label: 'On tap' },
  { value: 'on_deck', label: 'On deck' },
  { value: 'kicked', label: 'Kicked' },
  { value: 'archived', label: 'Archived' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const STATUS_LABEL: Record<string, string> = {
  on_tap: 'On tap', on_deck: 'On deck', kicked: 'Kicked', archived: 'Archived',
};

function statusText(k: KegHistoryRow): string {
  if (k.status === 'on_tap' && k.tapNumber != null) return `On tap ${k.tapNumber}`;
  if (k.status === 'on_deck' && k.tapNumber != null) return `On deck for tap ${k.tapNumber}`;
  return STATUS_LABEL[k.status] ?? k.status;
}

/** "Fifteen kegs on record. This month's kegs cost $1,268." */
export function kegsHeadline(kegs: KegHistoryRow[], now: Date = new Date()): string {
  if (kegs.length === 0) return 'No kegs yet.';
  const first = kegs.length === 1 ? 'One keg on record.' : `${capitalize(countWord(kegs.length))} kegs on record.`;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = kegs.filter((k) => (k.purchasedAt ?? k.createdAt).slice(0, 7) === month && k.costCents != null);
  if (thisMonth.length === 0) return `${first} No keg costs logged this month.`;
  const total = thisMonth.reduce((sum, k) => sum + (k.costCents ?? 0), 0);
  return `${first} This month’s kegs cost ${wholeMoney(total)}.`;
}

interface EditState {
  cost: string;
  deposit: string;
  supplierId: string; // '' = none
  purchasedAt: string;
}

/**
 * `/admin/kegs` (Kegwall V2 M8, prototypes/admin-kegs.html): every keg on record with what
 * it cost, owners only. KPIs as type over one table; editing a keg's cost, deposit, supplier
 * and purchase date happens in a drawer.
 */
export function KegsPage() {
  const [kegs, setKegs] = useState<KegHistoryRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<KegHistoryRow | null>(null);
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
    setEditing(k);
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
  const onTap = kegs.filter((k) => k.status === 'on_tap').length;
  const onDeck = kegs.filter((k) => k.status === 'on_deck').length;
  const perPints = kegs.map(perPintCents).filter((c): c is number => c !== null);
  const avgPerPint = perPints.length > 0 ? perPints.reduce((a, b) => a + b, 0) / perPints.length : null;

  return (
    <PageTemplate
      testId="kegs-page"
      title={status === 'loaded' ? kegsHeadline(kegs) : 'Kegs'}
      sub="Every pour is priced from its keg, so Insights can show what each beer costs you."
      drawer={editing && (
        <Drawer
          open
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          title={editing.beerName ?? 'Keg'}
          description={`${statusText(editing)} · ${Math.round(editing.sizeMl / 1000)} L${editing.dateTapped ? ` · tapped ${shortDate(editing.dateTapped)}` : ''}`}
          footer={(
            <>
              <Button variant="primary" data-testid={`keg-save-${editing.id}`} disabled={saving} onClick={() => save(editing.id)}>
                {saving ? 'Saving…' : 'Save keg'}
              </Button>
              <Button variant="quiet" data-testid={`keg-cancel-${editing.id}`} onClick={() => setEditing(null)}>Cancel</Button>
            </>
          )}
        >
          <div className="adm-form" data-testid={`keg-row-edit-${editing.id}`}>
            <div className="adm-grid-2">
              <label className="admin-field">
                <span>Cost ($)</span>
                <input
                  type="text" inputMode="decimal" placeholder="0.00"
                  data-testid={`keg-edit-cost-${editing.id}`}
                  value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                />
              </label>
              <label className="admin-field">
                <span>Deposit ($)</span>
                <input
                  type="text" inputMode="decimal" placeholder="0.00" data-testid={`keg-edit-deposit-${editing.id}`}
                  value={form.deposit} onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
                />
              </label>
            </div>
            <SelectField
              label="Supplier"
              data-testid={`keg-edit-supplier-${editing.id}`}
              value={form.supplierId}
              onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
            >
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <label className="admin-field">
              <span>Purchased</span>
              <input
                type="date" data-testid={`keg-edit-purchased-${editing.id}`}
                value={form.purchasedAt} onChange={(e) => setForm((f) => ({ ...f, purchasedAt: e.target.value }))}
              />
            </label>
            {error && <p className="adm-danger-text" role="alert" data-testid="kegs-save-error">{error}</p>}
          </div>
        </Drawer>
      )}
    >
      <p className="adm-note">Only owners see costs. Guests and staff never get them on any screen.</p>

      {status === 'loading' && <Skeleton height={44} />}
      {status === 'error' && (
        <div data-testid="kegs-error"><ErrorState title="Couldn’t load kegs." onRetry={load} /></div>
      )}

      {status === 'loaded' && (
        <>
          {kegs.length > 0 && (
            <div className="adm-kpis">
              <div className="adm-kpi"><b>{onTap}</b><span>on tap</span></div>
              <div className="adm-kpi"><b>{onDeck}</b><span>on deck</span></div>
              <div className="adm-kpi">
                <b>{avgPerPint === null ? '—' : money(Math.round(avgPerPint))}</b>
                <span>average cost per pint</span>
                {avgPerPint === null && <small>no keg costs logged yet</small>}
              </div>
            </div>
          )}
          <div className="adm-toolbar">
            <Chips<StatusFilter>
              label="Filter by status"
              testId="kegs-filter"
              value={filter}
              onChange={setFilter}
              options={STATUS_FILTERS.map((f) => ({
                value: f.value,
                label: <span data-testid={`kegs-filter-${f.value}`}>{f.label}</span>,
                count: f.value === 'all' ? kegs.length : kegs.filter((k) => k.status === f.value).length,
              }))}
            />
          </div>
          {shown.length === 0 ? (
            <div data-testid="kegs-empty">
              <EmptyState title="No kegs to show.">
                {kegs.length === 0 ? 'Kegs appear here once you tap one.' : 'Nothing matches this filter.'}
              </EmptyState>
            </div>
          ) : (
            <Table data-testid="kegs-table">
              <thead>
                <tr>
                  <th scope="col">Keg</th>
                  <th scope="col">Status</th>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="adm-num">Cost</th>
                  <th scope="col" className="adm-num">Per pint</th>
                  <th scope="col" className="adm-num">Deposit</th>
                  <th scope="col"><span className="adm-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((k) => (
                  <tr key={k.id} data-testid={`keg-row-${k.id}`} className={editing?.id === k.id ? 'is-selected' : undefined}>
                    <td>
                      <div className="adm-name adm-ell">{k.beerName ?? '—'}</div>
                      <div className="adm-sub">
                        {`${Math.round(k.sizeMl / 1000)} L`}
                        {k.dateTapped ? ` · tapped ${shortDate(k.dateTapped)}` : ''}
                        {k.purchasedAt ? ` · bought ${shortDate(k.purchasedAt)}` : ''}
                      </div>
                    </td>
                    <td className={k.status === 'kicked' || k.status === 'archived' ? 'adm-sub' : undefined}>{statusText(k)}</td>
                    <td data-testid={`keg-supplier-${k.id}`}>{k.supplierName ?? '—'}</td>
                    <td className="adm-num" data-testid={`keg-cost-${k.id}`}>{money(k.costCents)}</td>
                    <td className="adm-num">{money(perPintCents(k) === null ? null : Math.round(perPintCents(k)!))}</td>
                    <td className="adm-num">{money(k.depositCents)}</td>
                    <td className="adm-actions">
                      <Button variant="quiet" data-testid={`keg-edit-${k.id}`} onClick={() => openEdit(k)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </PageTemplate>
  );
}
