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

/**
 * Formats a Celsius temperature reading for display (WallHeader's temp readout):
 * `'metric'` renders the Celsius value directly, `'us'` converts to Fahrenheit — both
 * rounded to the nearest whole degree, which is plenty of precision for a taproom
 * ambient/fridge reading.
 */
export function formatTempC(tempC: number, units: VolumeUnits): string {
  if (units === 'metric') {
    return `${Math.round(tempC)}°C`;
  }
  const f = (tempC * 9) / 5 + 32;
  return `${Math.round(f)}°F`;
}

/**
 * Formats a temperature DIFFERENCE (not an absolute reading) in display units — scales by
 * 9/5 for Fahrenheit WITHOUT the +32 offset, keeps one decimal, and always shows the sign.
 * Used for "warmer/cooler than the reference" deltas on the dashboard sensor cards.
 */
export function formatTempDelta(deltaC: number, units: VolumeUnits): string {
  const v = units === 'metric' ? deltaC : (deltaC * 9) / 5;
  const rounded = Math.round(v * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}°${units === 'metric' ? 'C' : 'F'}`;
}
