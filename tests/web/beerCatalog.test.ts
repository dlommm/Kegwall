import { describe, it, expect } from 'vitest';
import { statusForBeer, beerCatalogSummary } from '../../src/web/lib/beerCatalog';
import type { Beer } from '../../src/server/db/beers';
import type { TapState } from '../../src/server/core/state';

function beer(id: number, over: Partial<Beer> = {}): Beer {
  return {
    id, name: `Beer ${id}`, brewery: null, style: null, abv: null, ibu: null, srm: 5, description: null, labelImage: null, createdAt: '', ...over,
  };
}

function tap(tapNumber: number, beerId: number | null, levelPct: number, status: 'on_tap' | 'kicked' = 'on_tap'): TapState {
  return {
    tapId: tapNumber, tapNumber, tapName: null,
    beer: beerId ? { id: beerId, name: `Beer ${beerId}`, brewery: null, style: null, abv: null, ibu: null, srm: 5, description: null, labelImage: null, createdAt: '' } : null,
    keg: beerId ? { id: tapNumber, beerId, tapId: tapNumber, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status, createdAt: '', kegType: null, costCents: null, levelPct, remainingMl: 0 } : null,
    lastPour: null, pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null, nextUpBeerName: null,
  };
}

describe('statusForBeer', () => {
  const taps = [tap(1, 10, 72), tap(2, 20, 8)];
  const onDeck = new Set([30]);

  it('reports on_tap with tap number and level, flagging low', () => {
    expect(statusForBeer(10, taps, onDeck)).toEqual({ kind: 'on_tap', tapNumber: 1, levelPct: 72, low: false });
    expect(statusForBeer(20, taps, onDeck)).toEqual({ kind: 'on_tap', tapNumber: 2, levelPct: 8, low: true });
  });

  it('reports on_deck for a queued beer and none for the rest', () => {
    expect(statusForBeer(30, taps, onDeck)).toEqual({ kind: 'on_deck' });
    expect(statusForBeer(99, taps, onDeck)).toEqual({ kind: 'none' });
  });

  it('ignores a kicked keg (not on_tap)', () => {
    const kicked = [tap(1, 10, 0, 'kicked')];
    expect(statusForBeer(10, kicked, new Set())).toEqual({ kind: 'none' });
  });
});

describe('beerCatalogSummary', () => {
  it('counts total, distinct on-tap beers, and beers missing label art', () => {
    const beers = [beer(10, { labelImage: 'x' }), beer(20), beer(30), beer(40)];
    const taps = [tap(1, 10, 72), tap(2, 20, 50)];
    expect(beerCatalogSummary(beers, taps)).toEqual({ total: 4, onTap: 2, missingArt: 3 });
  });
});
