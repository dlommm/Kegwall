/**
 * Volume display formatting for the wall/menu UI. `TapState`/`Beer` volumes are
 * always stored and transmitted in milliliters (see `src/server/db/kegs.ts`);
 * this module is the single place that turns a raw mL count into the string a
 * viewer reads, in whichever unit system the wall/menu is configured for.
 */

export type VolumeUnits = 'us' | 'metric';

/** Exact US customary fluid ounce, per NIST Handbook 44. */
const ML_PER_US_FL_OZ = 29.5735295625;

/**
 * Formats a milliliter volume for display. `'us'` renders US fluid ounces to
 * one decimal place (e.g. `473` -> `'16.0 oz'`); `'metric'` renders whole
 * milliliters (e.g. `473` -> `'473 mL'`). Negative/non-finite input is
 * clamped to 0 rather than producing a nonsensical string, since callers may
 * pass live, momentarily-inconsistent pour readouts.
 */
export function formatVolumeMl(ml: number, units: VolumeUnits): string {
  const safeMl = Number.isFinite(ml) ? Math.max(0, ml) : 0;
  if (units === 'metric') {
    return `${Math.round(safeMl)} mL`;
  }
  const oz = safeMl / ML_PER_US_FL_OZ;
  return `${oz.toFixed(1)} oz`;
}
