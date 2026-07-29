import type { VolumeUnits } from '../../lib/units';

/**
 * Shared helpers for the pour-takeover views (design turns 2 + 9).
 */

const ML_PER_US_FL_OZ = 29.5735295625;
/** The "one full glass" reference volume the fill/progress visuals normalize
 * against — a US pint. A real pour's total isn't known until it ends, so the
 * glass/bar/liquid render the fraction of a pint poured so far, capped full. */
export const REFERENCE_POUR_ML = 473.176;

/** Big-counter formatting: the number and its unit label separately (the
 * views typeset them at very different sizes, per the design). */
export function splitVolume(ml: number, units: VolumeUnits): { value: string; unit: string } {
  const safeMl = Number.isFinite(ml) ? Math.max(0, ml) : 0;
  if (units === 'metric') {
    return { value: `${Math.round(safeMl)}`, unit: 'ML' };
  }
  return { value: (safeMl / ML_PER_US_FL_OZ).toFixed(1), unit: 'OZ' };
}

/** Fraction (0-1) of the reference pour poured so far — drives the glass
 * fill, progress hairline/bar, and the full-bleed liquid height. */
export function pourFraction(ml: number): number {
  return Math.max(0, Math.min(1, ml / REFERENCE_POUR_ML));
}
