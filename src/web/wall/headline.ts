import type { WallTapModel } from './wallModel';
import { formatWholeVolume } from '../lib/lookData';
import type { VolumeUnits } from '../lib/units';

/**
 * The sentence a V2 wall leads with (blueprint §C.1: "status is written as a sentence
 * generated from real data"). One line that says the most useful true thing about the
 * taproom right now, and an optional second line of support. Pure, so every rule is tested.
 *
 * Priority, highest first:
 *  1. a keg that kicked in the last day (and what replaces it),
 *  2. a keg tapped in the last two days (newest first),
 *  3. a keg almost gone,
 *  4. tonight's pours, led by the busiest tap,
 *  5. what's on.
 * Live pours are deliberately not a headline: the takeover already owns that moment, and a
 * sentence that changed every second would be noise.
 */
export interface WallHeadline {
  lead: string;
  detail: string | null;
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A kicked keg leads the wall for this long after its last pour. */
export const JUST_KICKED_HOURS = 24;
/** A keg leads the wall as "Just tapped" for this long; after that it's only a NEW badge. */
export const JUST_TAPPED_HOURS = 48;

export function wallHeadline(taps: WallTapModel[], units: VolumeUnits, now: Date = new Date()): WallHeadline {
  const live = taps.filter((t) => t.hasBeer);
  const onTap = live.filter((t) => !t.isKicked);

  // A kicked keg has no kick timestamp of its own; its last pour is when it ran dry.
  const kicked = live.find((t) => t.isKicked
    && now.getTime() - Date.parse(t.tap.lastPour?.ts ?? '') <= JUST_KICKED_HOURS * 3_600_000);
  if (kicked?.name) {
    return {
      lead: `${kicked.name} just kicked.`,
      detail: kicked.nextUpName ? `${kicked.nextUpName} is next on tap ${kicked.tapNumber}.` : null,
    };
  }

  const tappedAt = (t: WallTapModel) => Date.parse(t.tap.keg?.dateTapped ?? '');
  const newest = onTap.filter((t) => t.isNew && t.name).sort((a, b) => tappedAt(b) - tappedAt(a));
  const first = newest[0];
  if (first && now.getTime() - tappedAt(first) <= JUST_TAPPED_HOURS * 3_600_000) {
    const rest = newest.slice(1, 3).map((t) => t.name!);
    return {
      lead: `Just tapped: ${first.name}.`,
      detail: rest.length ? `Also new this week: ${list(rest)}.` : null,
    };
  }

  const low = onTap.filter((t) => t.isLow && t.name).sort((a, b) => (a.servings ?? 0) - (b.servings ?? 0));
  if (low.length) {
    const t = low[0]!;
    const left = t.servingsLabel.startsWith('≈')
      ? `about ${t.servingsLabel.slice(2).replace(/ left$/, '')} left`
      : t.servingsLabel.toLowerCase();
    return {
      lead: `${t.name} is almost gone, ${left}.`,
      detail: t.nextUpName ? `${t.nextUpName} is next on tap ${t.tapNumber}.` : null,
    };
  }

  const pours = onTap.reduce((n, t) => n + t.tonightPours, 0);
  if (pours > 0) {
    const ml = onTap.reduce((n, t) => n + t.tonightMl, 0);
    const busiest = [...onTap].sort((a, b) => b.tonightPours - a.tonightPours)[0]!;
    return {
      lead: `${pours} ${pours === 1 ? 'pour' : 'pours'} tonight, ${formatWholeVolume(ml, units)} in all.`,
      detail: busiest.name ? `${busiest.name} is leading.` : null,
    };
  }

  if (!onTap.length) return { lead: 'Nothing on tap right now.', detail: null };
  return { lead: `${onTap.length} ${onTap.length === 1 ? 'beer' : 'beers'} on tap tonight.`, detail: null };
}
