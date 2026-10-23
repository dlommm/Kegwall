import type { WallTapModel } from '../wall/wallModel';
import { capitalize, countWord, LOW_PCT } from './tonightAttention';

// The Taps page's sentence header (Kegwall V2 M8, prototypes/admin-taps.html): what's on, what's
// empty and what's nearly done, then which keg to swap first. Pure, so the wording is tested.

type TapLike = Pick<WallTapModel,
  'tapNumber' | 'name' | 'hasBeer' | 'isKicked' | 'levelPct' | 'servings' | 'servingNoun'>;

/** No beer, no keg, or a kicked keg: the tap pours nothing. */
export function isEmptyTap(t: TapLike): boolean {
  return !t.hasBeer || t.isKicked || t.servings === null;
}

/** On tap but at or under the low line (the same 15 % as Tonight). */
export function isLowTap(t: TapLike): boolean {
  return !isEmptyTap(t) && Math.round(t.levelPct) <= LOW_PCT;
}

/** "about a pint", "about six pours", "under a pint". */
export function servingsLeftPhrase(servings: number, noun: 'pint' | 'pour'): string {
  if (servings < 1) return `under a ${noun}`;
  const n = Math.round(servings);
  return n === 1 ? `about a ${noun}` : `about ${countWord(n)} ${noun}s`;
}

/** "Twelve taps. Tap 12 is empty and two more kegs are nearly done." */
export function tapsHeadline(taps: TapLike[]): string {
  if (taps.length === 0) return 'No taps yet.';
  const count = capitalize(countWord(taps.length));
  const empty = taps.filter(isEmptyTap);
  const low = taps.filter(isLowTap);
  if (empty.length === 0 && low.length === 0) {
    return taps.length === 1 ? 'One tap, pouring.' : `${count} taps, all pouring.`;
  }
  const first = taps.length === 1 ? 'One tap.' : `${count} taps.`;
  const emptyPart = empty.length === 1
    ? `Tap ${empty[0]!.tapNumber} is empty`
    : empty.length > 1 ? `${capitalize(countWord(empty.length))} are empty` : null;
  const more = emptyPart ? 'more ' : '';
  const lowPart = low.length === 0
    ? null
    : low.length === 1 ? `one ${more}keg is nearly done` : `${countWord(low.length)} ${more}kegs are nearly done`;
  if (emptyPart && lowPart) return `${first} ${emptyPart} and ${lowPart}.`;
  return `${first} ${emptyPart ?? capitalize(lowPart!)}.`;
}

/** "Swap Midnight Oats on tap 4 first; it has about a pint left." or null when nothing is low. */
export function tapsSwapFirst(taps: TapLike[]): string | null {
  const low = taps.filter(isLowTap).sort((a, b) => (a.servings ?? 0) - (b.servings ?? 0));
  const t = low[0];
  if (!t) return null;
  const left = servingsLeftPhrase(t.servings ?? 0, t.servingNoun);
  return low.length === 1
    ? `Swap ${t.name ?? `the keg on tap ${t.tapNumber}`} on tap ${t.tapNumber} soon; it has ${left} left.`
    : `Swap ${t.name ?? `the keg on tap ${t.tapNumber}`} on tap ${t.tapNumber} first; it has ${left} left.`;
}
