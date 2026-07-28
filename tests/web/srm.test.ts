import { describe, it, expect } from 'vitest';
import { srmToColor } from '../../src/web/lib/srm';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('srmToColor', () => {
  it('returns well-formed hex strings for liquid and highlight', () => {
    for (const srm of [1, 2, 5, 10, 20, 30, 40]) {
      const { liquid, highlight } = srmToColor(srm);
      expect(liquid).toMatch(HEX_RE);
      expect(highlight).toMatch(HEX_RE);
    }
  });

  it('matches the published SRM reference table at known anchors', () => {
    // Values below are the whole-SRM-step reference table sourced from
    // https://www.barleydogbrewery.com/xml/colors.xml (the color data consumed
    // by the open-source chromabrew beer-color library, see src/web/lib/srm.ts).
    expect(srmToColor(2).liquid.toUpperCase()).toBe('#F8F753');
    expect(srmToColor(10).liquid.toUpperCase()).toBe('#BF813A');
    expect(srmToColor(40).liquid.toUpperCase()).toBe('#030403');
  });

  it('darkens monotonically as SRM rises, matching pale -> amber -> near-black', () => {
    const pale = luminance(srmToColor(2).liquid);
    const amber = luminance(srmToColor(10).liquid);
    const black = luminance(srmToColor(40).liquid);

    expect(pale).toBeGreaterThan(180); // SRM 2: pale straw, should read as bright
    expect(black).toBeLessThan(30); // SRM 40: near-black
    expect(pale).toBeGreaterThan(amber);
    expect(amber).toBeGreaterThan(black);
  });

  it('clamps below the table domain to SRM 1', () => {
    expect(srmToColor(0)).toEqual(srmToColor(1));
    expect(srmToColor(-5)).toEqual(srmToColor(1));
    expect(srmToColor(0.4)).toEqual(srmToColor(1));
  });

  it('clamps above the table domain to SRM 40', () => {
    expect(srmToColor(41)).toEqual(srmToColor(40));
    expect(srmToColor(100)).toEqual(srmToColor(40));
  });

  it('interpolates fractional SRM values between the surrounding whole steps', () => {
    const low = luminance(srmToColor(9).liquid);
    const mid = luminance(srmToColor(9.5).liquid);
    const high = luminance(srmToColor(10).liquid);

    expect(srmToColor(9.5).liquid).not.toBe(srmToColor(9).liquid);
    expect(srmToColor(9.5).liquid).not.toBe(srmToColor(10).liquid);
    // Luminance should fall strictly between the two neighboring whole steps
    // (SRM darkens monotonically across this range of the table).
    expect(mid).toBeLessThan(low);
    expect(mid).toBeGreaterThan(high);
  });

  it('maps null to a deterministic neutral amber default, distinct from the table edges', () => {
    const a = srmToColor(null);
    const b = srmToColor(null);
    expect(a).toEqual(b); // deterministic
    expect(a.liquid).toMatch(HEX_RE);
    const l = luminance(a.liquid);
    // Neutral amber: not pale-straw-bright, not stout-black.
    expect(l).toBeLessThan(luminance(srmToColor(2).liquid));
    expect(l).toBeGreaterThan(luminance(srmToColor(40).liquid));
  });

  it('highlight is a lightened version of liquid (always at least as bright)', () => {
    for (const srm of [1, 2, 10, 20, 40, null]) {
      const { liquid, highlight } = srmToColor(srm);
      expect(luminance(highlight)).toBeGreaterThanOrEqual(luminance(liquid));
      if (liquid !== '#FFFFFF' && liquid.toUpperCase() !== '#FFFFFF') {
        expect(highlight.toUpperCase()).not.toBe(liquid.toUpperCase());
      }
    }
  });
});
