import type { TapState } from '../../server/core/state.js';
import type { Pour } from '../../server/db/kegs.js';
import { formatVolumeMl, type VolumeUnits } from './units';
import { servingNounFor } from '../wall/wallModel';

// Tonight's "needs attention" list (Kegwall V2, blueprint §E.4; fixes issue 11). The old
// dashboard printed one row per signal, so eleven taps due for cleaning drowned out a source
// that had gone down. Here every signal of the same KIND folds into one row with one action,
// and rows rank problem → caution → info. Pure, so the ranking and wording are tested directly.

export type AttentionLevel = 'problem' | 'caution' | 'info';

export type AttentionKind =
  | 'power' | 'sources' | 'reboot' | 'low-kegs' | 'unassigned' | 'cleaning' | 'setup';

export interface AttentionItem {
  kind: AttentionKind;
  level: AttentionLevel;
  /** One sentence, the thing to know. */
  title: string;
  /** One line of detail under it. */
  detail: string;
  /** How many things the row folds together (kegs, sources, taps, pours). */
  count: number;
  /** The single action that resolves it: a link, or `reboot` (the page confirms first). */
  action?: { label: string; to: string } | { label: string; reboot: true };
}

/** At or below this level % a keg needs swapping soon (the same threshold as before). */
export const LOW_PCT = 15;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve'];

/** "two", "eleven", "14": words up to twelve, the way a bartender would say it. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "a", "a and b", "a, b and c". */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "about two pints" / "about five pours", with the same noun the tap rail uses. */
function servingsPhrase(remainingMl: number, servingSizeMl: number): string {
  const noun = servingNounFor(servingSizeMl);
  const n = remainingMl / servingSizeMl;
  if (n < 1) return `under a ${noun}`;
  const r = Math.round(n);
  return r === 1 ? `about a ${noun}` : `about ${countWord(r)} ${noun}s`;
}

export interface AttentionInput {
  taps: TapState[];
  units: VolumeUnits;
  servingSizeMl: number;
  /** Human labels of registered sources that are not answering. */
  downSources: string[];
  undervolted: { now: boolean; sinceBoot: boolean } | null;
  reboot: { required: boolean; osManaged: boolean } | null;
  /** Only admins may reboot; others see the row without the button. */
  canReboot: boolean;
  cleaningDueTapIds: number[];
  /** Tonight's pours; only consulted when the taproom has pourers to assign them to. */
  tonightPours: Pour[];
  hasPourers: boolean;
  /** False once the wall list loaded and was empty; null while unknown. */
  hasWall: boolean | null;
}

const RANK: Record<AttentionLevel, number> = { problem: 0, caution: 1, info: 2 };

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const tapByKegId = new Map(input.taps.filter((t) => t.keg).map((t) => [t.keg!.id, t]));

  if (input.undervolted && (input.undervolted.now || input.undervolted.sinceBoot)) {
    items.push({
      kind: 'power',
      level: 'problem',
      count: 1,
      title: input.undervolted.now
        ? 'This Pi isn’t getting enough power'
        : 'This Pi ran short of power since it started',
      detail: 'Use the official power supply. Low power corrupts SD cards and causes random crashes.',
    });
  }

  if (input.downSources.length === 1) {
    items.push({
      kind: 'sources',
      level: 'problem',
      count: 1,
      title: `${input.downSources[0]} stopped answering`,
      detail: 'Pours it reports may be missing until it’s back.',
      action: { label: 'Open the doctor', to: '/admin/doctor' },
    });
  } else if (input.downSources.length > 1) {
    items.push({
      kind: 'sources',
      level: 'problem',
      count: input.downSources.length,
      title: `${capitalize(countWord(input.downSources.length))} sources stopped answering`,
      detail: `${listJoin(input.downSources)}. Pours they report may be missing.`,
      action: { label: 'Open the doctor', to: '/admin/doctor' },
    });
  }

  const low = input.taps
    .filter((t) => t.keg && t.keg.status !== 'kicked' && Math.round(t.keg.levelPct) <= LOW_PCT)
    .sort((a, b) => a.keg!.remainingMl - b.keg!.remainingMl);
  if (low.length > 0) {
    const named = (t: TapState) => `${t.beer?.name ?? `The keg`} on tap ${t.tapNumber}`;
    const left = (t: TapState) => servingsPhrase(t.keg!.remainingMl, input.servingSizeMl);
    if (low.length === 1) {
      const t = low[0]!;
      items.push({
        kind: 'low-kegs',
        level: 'caution',
        count: 1,
        title: `Swap ${t.beer?.name ?? `the keg on tap ${t.tapNumber}`} soon`,
        detail: `${named(t)} has ${left(t)} left.${t.nextUpBeerName ? ` Next up: ${t.nextUpBeerName}.` : ''}`,
        action: { label: 'Plan the swap', to: `/admin/taps?tap=${t.tapId}` },
      });
    } else {
      items.push({
        kind: 'low-kegs',
        level: 'caution',
        count: low.length,
        title: `Swap ${countWord(low.length)} kegs soon`,
        detail: `${listJoin(low.slice(0, 3).map((t) => `${named(t)} (${left(t)})`))}${low.length > 3 ? ` and ${low.length - 3} more` : ''}.`,
        action: { label: 'Plan the swaps', to: '/admin/taps' },
      });
    }
  }

  if (input.reboot?.required) {
    items.push({
      kind: 'reboot',
      level: 'caution',
      count: 1,
      title: 'An OS update is waiting for a reboot',
      detail: 'The wall goes dark for a minute or two. Pours during the reboot are lost unless they sync back from the Kegtron cloud.',
      action: input.reboot.osManaged && input.canReboot ? { label: 'Reboot now', reboot: true } : undefined,
    });
  }

  if (input.hasPourers) {
    const unassigned = input.tonightPours.filter((p) => p.drinkerId == null);
    if (unassigned.length > 0) {
      const sample = unassigned.slice(0, 2).map((p) => {
        const beer = tapByKegId.get(p.kegId)?.beer?.name;
        const vol = formatVolumeMl(p.volumeMl, input.units);
        return beer ? `${beer} ${vol}` : vol;
      });
      items.push({
        kind: 'unassigned',
        level: 'info',
        count: unassigned.length,
        title: unassigned.length === 1
          ? 'One pour tonight has no name'
          : `${capitalize(countWord(unassigned.length))} pours tonight have no name`,
        detail: `${listJoin(sample)}${unassigned.length > 2 ? ` and ${unassigned.length - 2} more` : ''}.`,
        action: { label: unassigned.length === 1 ? 'Assign it' : 'Assign them', to: '/admin/pours' },
      });
    }
  }

  const tapById = new Map(input.taps.map((t) => [t.tapId, t]));
  const due = input.cleaningDueTapIds.filter((id) => tapById.has(id));
  if (due.length === 1) {
    const t = tapById.get(due[0]!)!;
    items.push({
      kind: 'cleaning',
      level: 'info',
      count: 1,
      title: `Tap ${t.tapNumber} is due for a line cleaning`,
      detail: 'Log the cleaning when it’s done, or turn the reminder off for this tap.',
      action: { label: 'Log a cleaning', to: `/admin/taps?tap=${t.tapId}` },
    });
  } else if (due.length > 1) {
    const numbers = due.map((id) => tapById.get(id)!.tapNumber).sort((a, b) => a - b);
    items.push({
      kind: 'cleaning',
      level: 'info',
      count: due.length,
      title: `${capitalize(countWord(due.length))} taps are due for a line cleaning`,
      detail: `Taps ${listJoin(numbers.map(String))}.`,
      action: { label: 'Log cleanings', to: '/admin/taps' },
    });
  }

  if (input.hasWall === false) {
    items.push({
      kind: 'setup',
      level: 'info',
      count: 1,
      title: 'There’s no tap wall yet',
      detail: 'Finish the guided setup to put your taps on a screen.',
      action: { label: 'Finish setting up', to: '/admin/welcome' },
    });
  }

  // Stable sort: within a level, the order above (power, sources, kegs, reboot, …) holds.
  return items.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** The page's sentence: "Eleven on tap. Two kegs need a swap soon." */
export function tonightHeadline(onTapCount: number, items: AttentionItem[]): string {
  const first = `${capitalize(countWord(onTapCount))} on tap.`;
  const top = items[0];
  if (!top) return `${first} Everything is running.`;
  if (top.kind === 'low-kegs') {
    return `${first} ${top.count === 1 ? 'One keg needs' : `${capitalize(countWord(top.count))} kegs need`} a swap soon.`;
  }
  return `${first} ${top.title}.`;
}
