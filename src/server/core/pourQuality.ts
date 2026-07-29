import { monitorRefKey, type MonitorRef } from './events.js';

/**
 * Pour quality score (design 6b): 0-100 from flow-rate consistency across a
 * pour's live UDP progress samples. A skilled, steady pour holds a constant
 * flow; sputtering (foam, a half-open faucet, glass jockeying) shows up as
 * variance between consecutive per-interval flow rates.
 *
 * Score = round(100 × (1 − cv)) clamped to [0, 100], where cv is the
 * coefficient of variation (stddev / mean) of the inter-sample flow rates.
 * cv 0 (perfectly steady) → 100; cv ≥ 1 (wildly erratic) → 0.
 *
 * A score needs at least MIN_RATES usable intervals — fewer (cloud-only pours
 * that never stream progress, sub-second blips) returns null and the pour
 * stores no quality rather than a garbage number.
 */

export interface PourSample {
  /** Milliseconds timestamp of the sample. */
  ts: number;
  /** The pour's cumulative volume at that moment (UDP `curServMl`). */
  ml: number;
}

const MIN_RATES = 3;

export function computePourQuality(samples: PourSample[]): number | null {
  const rates: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const dt = samples[i]!.ts - samples[i - 1]!.ts;
    const dml = samples[i]!.ml - samples[i - 1]!.ml;
    // Skip degenerate intervals: repeated packets (dt 0), clock weirdness, or
    // a counter that went backwards.
    if (dt <= 0 || dml < 0) continue;
    rates.push(dml / dt);
  }
  if (rates.length < MIN_RATES) return null;

  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return null;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - cv))));
}

/**
 * Per-monitor sample collector StateManager feeds from the live pour events:
 * `begin` on pour_started, `progress` on every pour_progress, and `take` on
 * pour_completed (returns the run's samples and clears them). Keyed by the
 * monitor ref so simultaneous pours on different taps don't mix samples.
 */
export class PourSampleTracker {
  private runs = new Map<string, PourSample[]>();

  begin(monitor: MonitorRef, ts: number): void {
    this.runs.set(monitorRefKey(monitor), [{ ts, ml: 0 }]);
  }

  progress(monitor: MonitorRef, ts: number, ml: number): void {
    const key = monitorRefKey(monitor);
    const run = this.runs.get(key);
    if (run) {
      run.push({ ts, ml });
    } else {
      // Progress without a seen start (source came up mid-pour): start a run
      // from this sample so a long pour can still accumulate enough to score.
      this.runs.set(key, [{ ts, ml }]);
    }
  }

  /** Returns and clears the samples for this monitor's current run. */
  take(monitor: MonitorRef): PourSample[] {
    const key = monitorRefKey(monitor);
    const run = this.runs.get(key) ?? [];
    this.runs.delete(key);
    return run;
  }
}
