import { useState } from 'react';
import type { GroupProps } from './shared';
import { Switch } from '../ui';
import { useSettingsGroupForm } from './useSettingsGroupForm';

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
  const [showCostsToViewers, setShowCostsToViewers] = useState(settings.pricing.showCostsToViewers);

  const dirty = enabled !== settings.pricing.enabled
    || markupPct !== String(settings.pricing.markupPct)
    || taxPct !== String(settings.pricing.taxPct)
    || rounding !== settings.pricing.rounding
    || showCostsToViewers !== settings.pricing.showCostsToViewers;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      const pct = Number(markupPct.trim());
      if (!Number.isFinite(pct) || pct < 0 || pct > 2000) {
        return 'Markup must be a percent between 0 and 2000.';
      }
      const tax = Number(taxPct.trim());
      if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
        return 'Sales tax must be a percent between 0 and 100.';
      }
      return { pricing: { enabled, markupPct: pct, taxPct: tax, rounding, showCostsToViewers } };
    },
  });

  return (
    <form className="settings-group" data-testid="settings-group-pricing" onSubmit={handleSubmit} aria-labelledby="settings-pricing-title">
      <h2 id="settings-pricing-title" className="admin-field__label-text">Pricing</h2>
      <Switch className="settings-toggle" data-testid="settings-pricing-enabled" checked={enabled} onCheckedChange={setEnabled} label={<>Show price per pour on public pages (menu, wall, board)</>} />
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
            className="adm-select"
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
      <Switch className="settings-toggle" data-testid="settings-pricing-viewer-costs" checked={showCostsToViewers} onCheckedChange={setShowCostsToViewers} label={<>Show keg costs to viewer accounts (off = costs stay editor/admin-only)</>} />
      {/* WHO SEES WHAT — the privacy boundary in plain language. */}
      <p className="settings-pricing__matrix" data-testid="settings-pricing-matrix">
        <strong>Who sees what:</strong>
        {' '}
        Admin analytics show cost, price, and margin. Viewer accounts see costs only when you
        opt them in above. Public surfaces show the marked-up price only — never your cost.
        Turn this off and no prices appear anywhere public.
      </p>
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-pricing-error">{error}</p>}
      <button type="submit" className="beer-form__submit" data-dirty={dirty || undefined}
          disabled={!dirty || submitting} data-testid="settings-pricing-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
