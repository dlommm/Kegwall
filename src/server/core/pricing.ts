// Keg cost → public display price (WebUI redesign 4k). Pure and server-side: the raw owner
// cost never leaves the server — only this COMPUTED display price is ever serialized to a
// public surface, and only when pricing is enabled. Kept dependency-free so both the API
// layer and tests can call it directly.

export const ML_PER_PINT = 473.176;

export interface PricingConfig {
  enabled: boolean;
  /** Markup percent applied to owner cost, e.g. 245 → cost × 3.45. */
  markupPct: number;
  /** Round the marked-up per-pint price to the nearest this-many dollars (0.05/0.25/0.5/1). */
  rounding: number;
}

/** How many pints a keg of `sizeMl` yields (before foam/loss). */
export function pintsInKeg(sizeMl: number): number {
  return sizeMl / ML_PER_PINT;
}

/**
 * The public per-pint display price in cents, or null when there's nothing to show
 * (untracked cost, non-positive size). Applies the per-beer override markup when provided,
 * otherwise the global markup, then rounds to the configured increment.
 *
 * NOTE: this returns the DISPLAY price only. Callers must never also serialize the owner
 * cost that fed it onto a public surface (hard requirement).
 */
export function displayPricePerPintCents(input: {
  costCents: number | null;
  sizeMl: number;
  markupPct: number;
  rounding: number;
  overridePct?: number | null;
}): number | null {
  const {
    costCents, sizeMl, markupPct, rounding, overridePct,
  } = input;
  if (costCents == null || sizeMl <= 0) return null;
  const pints = pintsInKeg(sizeMl);
  if (pints <= 0) return null;
  const costPerPint = costCents / pints;
  const pct = overridePct ?? markupPct;
  const marked = costPerPint * (1 + pct / 100);
  const roundingCents = Math.max(1, Math.round(rounding * 100));
  return Math.round(marked / roundingCents) * roundingCents;
}
