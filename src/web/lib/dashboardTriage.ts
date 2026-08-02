import type { TapState } from '../../server/core/state.js';

// NEEDS ATTENTION triage (WebUI redesign 3b). Rolls the dashboard's scattered warning signals
// — low kegs, cleaning-due taps, unhealthy sources, undervoltage — into one ranked, actionable
// list (severity dot + plain-language sentence + THE action inline). Pure so it's trivially
// testable; the dashboard derives the inputs from data it already polls.

export type TriageSeverity = 'danger' | 'warn';

export interface TriageItem {
  id: string;
  severity: TriageSeverity;
  message: string;
  /** Inline action — a link to the page that resolves the issue. */
  action?: { label: string; to: string };
}

/** At or below this level % a keg is "almost gone" and triaged for a swap (design threshold). */
const LOW_PCT = 15;

export function buildTriage(input: {
  taps: TapState[];
  /** Human labels of registered-but-unhealthy sources (already resolved by the caller). */
  unhealthySourceLabels: string[];
  /** Tap ids whose line cleaning is due (from getCleaningStatuses). */
  cleaningDueTapIds: number[];
  undervolted: boolean;
}): TriageItem[] {
  const {
    taps, unhealthySourceLabels, cleaningDueTapIds, undervolted,
  } = input;
  const items: TriageItem[] = [];

  if (undervolted) {
    items.push({
      id: 'undervolt', severity: 'danger',
      message: "This Pi isn't getting enough power — use the official power supply.",
    });
  }

  for (const label of unhealthySourceLabels) {
    items.push({
      id: `source-${label}`, severity: 'danger',
      message: `${label} is down — pours from it may be missing.`,
      action: { label: 'Open doctor', to: '/admin/doctor' },
    });
  }

  for (const tap of taps) {
    const keg = tap.keg;
    if (!keg || keg.status === 'kicked') continue;
    const pct = Math.round(keg.levelPct);
    if (pct > LOW_PCT) continue;
    const beer = tap.beer?.name ?? `Tap ${tap.tapNumber}`;
    const nextUp = tap.nextUpBeerName ? ` Next up: ${tap.nextUpBeerName}.` : '';
    items.push({
      id: `low-${tap.tapId}`, severity: 'warn',
      message: `${beer} on Tap ${tap.tapNumber} is at ${pct}% — swap it soon.${nextUp}`,
      action: { label: 'Swap keg →', to: '/admin/taps' },
    });
  }

  const tapNumberById = new Map(taps.map((t) => [t.tapId, t.tapNumber]));
  for (const tapId of cleaningDueTapIds) {
    const num = tapNumberById.get(tapId) ?? tapId;
    items.push({
      id: `clean-${tapId}`, severity: 'warn',
      message: `Tap ${num} is due for a line cleaning.`,
      action: { label: 'Log cleaning', to: '/admin/taps' },
    });
  }

  // Danger first, then warnings (stable within each severity).
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1));
}
