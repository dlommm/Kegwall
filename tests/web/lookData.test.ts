import { describe, it, expect } from 'vitest';
import type { TapState } from '../../src/server/core/state';
import {
  tapLookModel, levelStatus, formatWholeVolume, NEW_BADGE_DAYS,
} from '../../src/web/lib/lookData';

const NOW = new Date('2026-07-29T12:00:00Z');

function makeTap(overrides: Partial<TapState> = {}): TapState {
  return {
    tapId: 1,
    tapNumber: 1,
    tapName: null,
    beer: {
      id: 1,
      name: 'Cloud Cover',
      brewery: 'Halfmoon Brewing',
      style: 'Hazy IPA',
      abv: 6.8,
      ibu: 58,
      srm: 5,
      description: 'Double dry-hopped with Citra and Galaxy.',
      labelImage: null,
      createdAt: '',
    },
    keg: {
      id: 1,
      beerId: 1,
      tapId: 1,
      sizeMl: 19000,
      volStartMl: 19000,
      volDispensedMl: 19000 * 0.22,
      dateTapped: '2026-07-01T00:00:00Z',
      status: 'on_tap',
      createdAt: '',
      kegType: null,
      levelPct: 78,
      remainingMl: 19000 * 0.78,
    },
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true,
    temp: null,
    ...overrides,
  };
}

describe('levelStatus', () => {
  it('follows the ≤15 danger / ≤35 warn / ok thresholds', () => {
    expect(levelStatus(10)).toBe('danger');
    expect(levelStatus(15)).toBe('danger');
    expect(levelStatus(16)).toBe('warn');
    expect(levelStatus(35)).toBe('warn');
    expect(levelStatus(36)).toBe('ok');
  });
});

describe('formatWholeVolume', () => {
  it('renders whole grouped ounces for US', () => {
    expect(formatWholeVolume(19000 * 0.78, 'us')).toBe('501 oz');
    expect(formatWholeVolume(58670, 'us')).toBe('1,984 oz');
  });

  it('renders tenth-liters for metric', () => {
    expect(formatWholeVolume(14820, 'metric')).toBe('14.8 L');
  });
});

describe('tapLookModel', () => {
  it('derives level, status, servings and volume labels', () => {
    const m = tapLookModel(makeTap(), 'us', NOW);
    expect(m.levelPct).toBe(78);
    expect(m.status).toBe('ok');
    expect(m.remainingLabel).toBe('501 oz');
    expect(m.pouredLabel).toBe('141 oz');
    // 14 820 mL / 473.176 mL per pint ≈ 31.
    expect(m.servingsLeft).toBe(31);
    expect(m.servingsNoun).toBe('pints');
    expect(m.hasBeer).toBe(true);
  });

  it('uses 500 mL pours as the metric serving', () => {
    const m = tapLookModel(makeTap(), 'metric', NOW);
    expect(m.servingsLeft).toBe(30);
    expect(m.servingsNoun).toBe('pours');
  });

  it('estimates kcal, OG and BU:GU from ABV/IBU', () => {
    const m = tapLookModel(makeTap(), 'us', NOW);
    // kcal ≈ ABV × 30 (design mapping).
    expect(m.kcal).toBe(204);
    // OG ≈ 1 + 6.8/131.25 + 0.012 ≈ 1.064.
    expect(m.ogLabel).toBe('1.064');
    // BU:GU = 58 / 63.8 ≈ 0.91.
    expect(m.buGuLabel).toBe('0.91');
  });

  it('leaves the estimates null without an ABV', () => {
    const tap = makeTap();
    tap.beer = { ...tap.beer!, abv: null };
    const m = tapLookModel(tap, 'us', NOW);
    expect(m.kcal).toBeNull();
    expect(m.ogLabel).toBeNull();
    expect(m.buGuLabel).toBeNull();
  });

  it('flags NEW inside the badge window and not after it', () => {
    const fresh = makeTap();
    fresh.keg = { ...fresh.keg!, dateTapped: '2026-07-27T00:00:00Z' };
    expect(tapLookModel(fresh, 'us', NOW).isNew).toBe(true);

    const stale = makeTap();
    stale.keg = { ...stale.keg!, dateTapped: '2026-07-01T00:00:00Z' };
    expect(tapLookModel(stale, 'us', NOW).isNew).toBe(false);

    // Boundary: exactly NEW_BADGE_DAYS ago still counts.
    const edge = makeTap();
    edge.keg = {
      ...edge.keg!,
      dateTapped: new Date(NOW.getTime() - NEW_BADGE_DAYS * 24 * 3600 * 1000).toISOString(),
    };
    expect(tapLookModel(edge, 'us', NOW).isNew).toBe(true);
  });

  it('flags ALMOST GONE at ≤15% and matches the danger status', () => {
    const low = makeTap();
    low.keg = { ...low.keg!, levelPct: 12, remainingMl: 19000 * 0.12 };
    const m = tapLookModel(low, 'us', NOW);
    expect(m.isLow).toBe(true);
    expect(m.status).toBe('danger');
  });

  it('a kicked keg reads drained: 0%, no badges, no pouring', () => {
    const kicked = makeTap({ pouring: true, curServMl: 200 });
    kicked.keg = { ...kicked.keg!, status: 'kicked', dateTapped: '2026-07-28T00:00:00Z' };
    const m = tapLookModel(kicked, 'us', NOW);
    expect(m.isKicked).toBe(true);
    expect(m.levelPct).toBe(0);
    expect(m.isNew).toBe(false);
    expect(m.isLow).toBe(false);
    expect(m.pouring).toBe(false);
    expect(m.pourLabel).toBeNull();
  });

  it('carries the live pour readout while pouring', () => {
    const m = tapLookModel(makeTap({ pouring: true, curServMl: 366.7 }), 'us', NOW);
    expect(m.pouring).toBe(true);
    expect(m.pourLabel).toBe('12.4 oz');
  });

  it('an empty tap has no beer and no labels', () => {
    const m = tapLookModel(makeTap({ beer: null, keg: null }), 'us', NOW);
    expect(m.hasBeer).toBe(false);
    expect(m.remainingLabel).toBeNull();
    expect(m.servingsLeft).toBeNull();
  });

  it('resolves the keg type from sizeMl when the keg has no explicit type', () => {
    const m = tapLookModel(makeTap(), 'us', NOW);
    // 19 L ≈ a cornelius/sixth-barrel-class keg — must resolve to SOME type.
    expect(m.kegType).not.toBeNull();

    const typed = makeTap();
    typed.keg = { ...typed.keg!, kegType: 'half-barrel' };
    expect(tapLookModel(typed, 'us', NOW).kegType).toBe('half-barrel');
  });
});
