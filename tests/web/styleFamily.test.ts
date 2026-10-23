import { describe, it, expect } from 'vitest';
import { styleFamilyOf } from '../../src/web/lib/styleFamily';

describe('styleFamilyOf', () => {
  it.each([
    ['Hazy IPA', 'hoppy'], ['West Coast IPA', 'hoppy'], ['American Pale Ale', 'hoppy'], ['Black IPA', 'hoppy'],
    ['Oatmeal Stout', 'dark'], ['Robust Porter', 'dark'], ['Doppelbock', 'dark'], ['English Brown Ale', 'dark'],
    ['German Pils', 'light'], ['Munich Helles', 'light'], ['Hefeweizen', 'light'], ['Kölsch', 'light'], ['Vienna Lager', 'light'],
    ['Fruited Sour', 'sour'], ['Gose', 'sour'], ['Sour IPA', 'sour'], ['Kriek', 'sour'],
  ])('%s → %s', (style, family) => {
    expect(styleFamilyOf(style, null)).toBe(family);
  });

  it('leaves ciders and unknown styles out of every family', () => {
    expect(styleFamilyOf('Dry Cider', 4)).toBeNull();
    expect(styleFamilyOf('Mead', null)).toBeNull();
  });

  it('falls back to color only when there is no style at all', () => {
    expect(styleFamilyOf(null, 35)).toBe('dark');
    expect(styleFamilyOf('', 3)).toBe('light');
    expect(styleFamilyOf(null, 12)).toBeNull();
    expect(styleFamilyOf(null, null)).toBeNull();
  });
});
