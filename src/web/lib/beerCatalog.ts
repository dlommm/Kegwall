import type { Beer } from '../../server/db/beers.js';
import type { TapState } from '../../server/core/state.js';

// Beer-catalog derivations for the Beers page (WebUI redesign 3f): the header count summary
// and each beer's live STATUS (on a tap with its level, queued on deck, or neither). Pure so
// the page just feeds it the data it already loads (menu taps + on-deck beer ids).

/** At or below this level % an on-tap beer's status pill reads low (amber). */
const LOW_PCT = 15;

export type BeerStatus =
  | { kind: 'on_tap'; tapNumber: number; levelPct: number; low: boolean }
  | { kind: 'on_deck' }
  | { kind: 'none' };

export interface BeerCatalogSummary {
  total: number;
  /** Distinct beers currently on a tap (an on_tap keg). */
  onTap: number;
  missingArt: number;
}

export function statusForBeer(
  beerId: number,
  taps: TapState[],
  onDeckBeerIds: Set<number>,
): BeerStatus {
  const tap = taps.find((t) => t.beer?.id === beerId && t.keg != null && t.keg.status === 'on_tap');
  if (tap && tap.keg) {
    const levelPct = Math.round(tap.keg.levelPct);
    return {
      kind: 'on_tap', tapNumber: tap.tapNumber, levelPct, low: levelPct <= LOW_PCT,
    };
  }
  if (onDeckBeerIds.has(beerId)) return { kind: 'on_deck' };
  return { kind: 'none' };
}

export function beerCatalogSummary(beers: Beer[], taps: TapState[]): BeerCatalogSummary {
  const onTapBeerIds = new Set(
    taps.filter((t) => t.beer != null && t.keg != null && t.keg.status === 'on_tap').map((t) => t.beer!.id),
  );
  return {
    total: beers.length,
    onTap: onTapBeerIds.size,
    missingArt: beers.filter((b) => !b.labelImage).length,
  };
}
