import type { TapState } from '../../server/core/state.js';

// QR-menu filtering (WebUI redesign 2b): the All / New / Almost-gone chip row and the "N on
// tap" header count. Pure and now-injectable so the menu just feeds it the live tap list.

export type MenuFilter = 'all' | 'new' | 'low';

/** A keg tapped within this many days reads as NEW. */
const NEW_DAYS = 7;
/** At or below this level % a keg reads as "almost gone". */
const LOW_PCT = 15;

function isActive(tap: TapState): boolean {
  return tap.beer != null && tap.keg != null && tap.keg.status !== 'kicked';
}

export function isNewTap(tap: TapState, now: Date = new Date()): boolean {
  if (!isActive(tap) || !tap.keg!.dateTapped) return false;
  const days = (now.getTime() - new Date(tap.keg!.dateTapped).getTime()) / (24 * 60 * 60 * 1000);
  return days >= 0 && days <= NEW_DAYS;
}

export function isLowTap(tap: TapState): boolean {
  return isActive(tap) && tap.keg!.levelPct <= LOW_PCT;
}

/** How many taps currently have a beer on an un-kicked keg — the header count pill. */
export function onTapCount(taps: TapState[]): number {
  return taps.filter(isActive).length;
}

export function filterMenuTaps(taps: TapState[], filter: MenuFilter, now: Date = new Date()): TapState[] {
  if (filter === 'new') return taps.filter((t) => isNewTap(t, now));
  if (filter === 'low') return taps.filter(isLowTap);
  return taps;
}
