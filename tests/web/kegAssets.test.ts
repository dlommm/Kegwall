import { describe, it, expect } from 'vitest';
import {
  KEG_ASSET_IDS, KEG_ASSETS, matchKegType, resolveKegAsset,
} from '../../src/web/lib/kegAssets';

describe('KEG_ASSETS', () => {
  it('has exactly the 7 shipped keg assets, each with a positive volumeMl and a src', () => {
    expect(KEG_ASSET_IDS).toHaveLength(7);
    for (const id of KEG_ASSET_IDS) {
      const asset = KEG_ASSETS[id];
      expect(asset.id).toBe(id);
      expect(asset.volumeMl).toBeGreaterThan(0);
      expect(typeof asset.src).toBe('string');
      expect(asset.src.length).toBeGreaterThan(0);
    }
  });

  it('matches the user-supplied volumes exactly', () => {
    expect(KEG_ASSETS['half-barrel'].volumeMl).toBe(58674);
    expect(KEG_ASSETS['quarter-barrel'].volumeMl).toBe(29337);
    expect(KEG_ASSETS['sixth-barrel'].volumeMl).toBe(19558);
    expect(KEG_ASSETS['fifty-liter'].volumeMl).toBe(50000);
    expect(KEG_ASSETS['cornelius'].volumeMl).toBe(18927);
    expect(KEG_ASSETS['slim-quarter'].volumeMl).toBe(29337);
    expect(KEG_ASSETS['mini-keg'].volumeMl).toBe(5000);
  });
});

describe('matchKegType', () => {
  it('matches an exact, unambiguous size to its asset', () => {
    expect(matchKegType(58674)).toBe('half-barrel');
    expect(matchKegType(19558)).toBe('sixth-barrel');
    expect(matchKegType(50000)).toBe('fifty-liter');
    expect(matchKegType(18927)).toBe('cornelius');
    expect(matchKegType(5000)).toBe('mini-keg');
  });

  it('defaults the 29337 mL ambiguity (quarter-barrel vs slim-quarter) to quarter-barrel', () => {
    expect(matchKegType(29337)).toBe('quarter-barrel');
  });

  it('picks the nearest asset for an off-table size', () => {
    // 19300 mL sits between sixth-barrel (19558, diff 258) and cornelius (18927, diff
    // 373) -- nearest is sixth-barrel.
    expect(matchKegType(19300)).toBe('sixth-barrel');
    // 19100 mL is nearest cornelius (18927, diff 173) over sixth-barrel (19558, diff 458).
    expect(matchKegType(19100)).toBe('cornelius');
  });

  it('matches the largest asset for a size far above the table', () => {
    expect(matchKegType(200000)).toBe('half-barrel');
  });

  it('matches the smallest asset for a size far below the table', () => {
    expect(matchKegType(100)).toBe('mini-keg');
  });
});

describe('resolveKegAsset', () => {
  it('auto-selects by size when no override is given', () => {
    expect(resolveKegAsset(58674, null).id).toBe('half-barrel');
    expect(resolveKegAsset(58674, undefined).id).toBe('half-barrel');
  });

  it('an explicit override wins over the size-based auto-match', () => {
    // 58674 auto-matches half-barrel, but an explicit override to mini-keg must win.
    expect(resolveKegAsset(58674, 'mini-keg').id).toBe('mini-keg');
  });

  it('falls back to auto-match for an unrecognized override id', () => {
    expect(resolveKegAsset(58674, 'not-a-real-id' as never).id).toBe('half-barrel');
  });
});
