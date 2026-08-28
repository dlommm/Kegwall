import { useState, type FormEvent } from 'react';
import { patchSettings } from '../../../lib/adminApi';
import type { GroupProps } from './shared';

const ROUNDING_OPTIONS = [0.05, 0.25, 0.5, 1] as const;

/**
 * Pricing group (redesign 4k): the master toggle for showing marked-up per-pour prices on
 * public surfaces, the markup %, and the rounding increment. OFF (default) = no price appears
 * anywhere public. The OWNER COST that feeds the price never leaves the server — this only
 * configures the public DISPLAY price (see core/pricing.ts + routes/public.ts).
 */
export function PricingGroup({ settings, onSaved }: GroupProps) {
  const [enabled, setEnabled] = useState(settings.pricing.enabled);
  const [markupPct, setMarkupPct] = useState(String(settings.pricing.markupPct));
  const [taxPct, setTaxPct] = useState(String(settings.pricing.taxPct));
  const [rounding, setRounding] = useState(settings.pricing.rounding);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== settings.pricing.enabled
    || markupPct !== String(settings.pricing.markupPct)
    || taxPct !== String(settings.pricing.taxPct)
    || rounding !== settings.pricing.rounding;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const pct = Number(markupPct.trim());
    if (!Number.isFinite(pct) || pct < 0 || pct > 2000) {
      setError('Markup must be a percent between 0 and 2000.');
      return;
    }
    const tax = Number(taxPct.trim());
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      setError('Sales tax must be a percent between 0 and 100.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await patchSettings({ pricing: { enabled, markupPct: pct, taxPct: tax, rounding } });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, { pricing: { enabled, markupPct: pct, taxPct: tax, rounding } });
  }

  return (
    <form className="settings-group" data-testid="settings-group-pricing" onSubmit={handleSubmit} aria-labelledby="settings-pricing-title">
      <h2 id="settings-pricing-title" className="admin-field__label-text">Pricing</h2>
      <label className="admin-field admin-field--checkbox">
        <input
          type="checkbox"
          data-testid="settings-pricing-enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>Show price per pour on public pages (menu, wall, board)</span>
      </label>
      <div className="settings-group__grid">
        <label className="admin-field">
          <span>Markup %</span>
          <input
            type="text"
            inputMode="numeric"
            data-testid="settings-pricing-markup"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Sales tax %</span>
          <input
            type="text"
            inputMode="decimal"
            data-testid="settings-pricing-tax"
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Round to</span>
          <select
            data-testid="settings-pricing-rounding"
            value={rounding}
            onChange={(e) => setRounding(Number(e.target.value))}
          >
            {ROUNDING_OPTIONS.map((r) => (
              <option key={r} value={r}>{`$${r.toFixed(2)}`}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="admin-page-quiet" data-testid="settings-pricing-tax-note">
        The menu price is <strong>tax-included</strong> — sales tax is folded in, so the number shown
        is what the customer pays. Set tax to 0 to show pre-tax prices.
      </p>
      {/* WHO SEES WHAT — the privacy boundary in plain language. */}
      <p className="settings-pricing__matrix" data-testid="settings-pricing-matrix">
        <strong>Who sees what:</strong>
        {' '}
        Admin analytics show cost, price, and margin. Public surfaces show the marked-up
        price only — never your cost. Turn this off and no prices appear anywhere public.
      </p>
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-pricing-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-pricing-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
