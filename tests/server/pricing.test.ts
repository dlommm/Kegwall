import { describe, it, expect } from 'vitest';
import { displayPricePerPintCents, pintsInKeg } from '../../src/server/core/pricing.js';

describe('displayPricePerPintCents', () => {
  it('marks up owner cost per pint and rounds to the configured increment', () => {
    // A half-barrel (58,674 mL ≈ 124 pints) at $131.00 → ~$1.06/pint cost.
    // 124 pints × ? — use a round keg: 47,318 mL = 100 pints, cost $131 → $1.31/pint.
    const cents = displayPricePerPintCents({
      costCents: 13100, sizeMl: 47318, markupPct: 245, rounding: 0.25,
    });
    // $1.31 × 3.45 = $4.5195 → round to nearest $0.25 = $4.50 = 450 cents.
    expect(cents).toBe(450);
  });

  it('honors a per-beer override markup over the global one', () => {
    const base = displayPricePerPintCents({
      costCents: 13100, sizeMl: 47318, markupPct: 245, rounding: 0.25,
    });
    const overridden = displayPricePerPintCents({
      costCents: 13100, sizeMl: 47318, markupPct: 245, rounding: 0.25, overridePct: 100,
    });
    // 100% markup → $1.31 × 2 = $2.62 → nearest $0.25 = $2.50.
    expect(overridden).toBe(250);
    expect(overridden).toBeLessThan(base!);
  });

  it('returns null when cost is untracked or size is non-positive', () => {
    expect(displayPricePerPintCents({ costCents: null, sizeMl: 47318, markupPct: 245, rounding: 0.25 })).toBeNull();
    expect(displayPricePerPintCents({ costCents: 13100, sizeMl: 0, markupPct: 245, rounding: 0.25 })).toBeNull();
  });

  it('pintsInKeg converts mL to pints', () => {
    expect(pintsInKeg(47318)).toBeCloseTo(100, 1);
  });
});
