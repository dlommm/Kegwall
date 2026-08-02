import type { SensorSummary } from './adminApi';

// Per-sensor dashboard cards (WebUI redesign 3b). Adds the cross-sensor comparison the raw
// summaries can't carry on their own: each Govee sensor's delta against the Kegtron serving-
// temp reference, and the "warming" alert that delta triggers. Pure and reference-relative —
// no fixed temperature thresholds invented (the beer's correct serving temp is whatever the
// Kegtron probe reads; a room sensor running warmer than that is the real signal).

export interface SensorCardModel extends SensorSummary {
  /** °C warmer (+) or cooler (−) than the Kegtron reference. Null for Kegtron probes
   *  themselves and when there is no reference to compare against. */
  deltaVsRefC: number | null;
  /** This sensor reads meaningfully warmer than the serving-temp reference. */
  warming: boolean;
}

/** A Govee sensor at least this many °C warmer than the Kegtron reference reads as "warming". */
const WARMING_DELTA_C = 2;

export function buildSensorCards(sensors: SensorSummary[]): SensorCardModel[] {
  // The coldest Kegtron probe is the serving-temp reference the room sensors compare against.
  const refTemps = sensors
    .filter((s) => s.kind === 'kegtron' && s.tempC != null)
    .map((s) => s.tempC as number);
  const refC = refTemps.length ? Math.min(...refTemps) : null;

  return sensors.map((s) => {
    const deltaVsRefC = refC != null && s.tempC != null && s.kind === 'govee'
      ? Math.round((s.tempC - refC) * 10) / 10
      : null;
    return {
      ...s,
      deltaVsRefC,
      warming: deltaVsRefC != null && deltaVsRefC >= WARMING_DELTA_C,
    };
  });
}
