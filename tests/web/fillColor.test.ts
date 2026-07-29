import { describe, it, expect } from 'vitest';
import { levelToColor } from '../../src/web/lib/fillColor';

/** Pulls the three numbers out of an `hsl(h, s%, l%)` string. */
function parseHsl(color: string): { h: number; s: number; l: number } {
  const m = color.match(/^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
  if (!m) throw new Error(`not an hsl() string: ${color}`);
  const [, h, s, l] = m as unknown as [string, string, string, string];
  return { h: Number(h), s: Number(s), l: Number(l) };
}

describe('levelToColor', () => {
  it('anchors at 100% to the spec green: hsl(120, 70%, 45%)', () => {
    expect(parseHsl(levelToColor(100))).toEqual({ h: 120, s: 70, l: 45 });
  });

  it('anchors at 50% to the spec yellow: hsl(60, 75%, 50%)', () => {
    expect(parseHsl(levelToColor(50))).toEqual({ h: 60, s: 75, l: 50 });
  });

  it('anchors at 10% (and below) to the spec red: hsl(0, 75%, 50%)', () => {
    expect(parseHsl(levelToColor(10))).toEqual({ h: 0, s: 75, l: 50 });
    expect(parseHsl(levelToColor(5))).toEqual({ h: 0, s: 75, l: 50 });
    expect(parseHsl(levelToColor(0))).toEqual({ h: 0, s: 75, l: 50 });
  });

  it('interpolates hue linearly on the 100->50 leg (75% -> ~90 deg, halfway between 120 and 60)', () => {
    const { h } = parseHsl(levelToColor(75));
    expect(h).toBeCloseTo(90, 0);
  });

  it('interpolates hue linearly on the 50->10 leg (30% -> ~30 deg, halfway between 60 and 0)', () => {
    const { h } = parseHsl(levelToColor(30));
    expect(h).toBeCloseTo(30, 0);
  });

  it('is continuous at the 50% seam (approaching from either leg gives the same color)', () => {
    expect(levelToColor(50)).toBe(levelToColor(49.999));
  });

  it('clamps out-of-range input to the 0-100 domain', () => {
    expect(levelToColor(150)).toBe(levelToColor(100));
    expect(levelToColor(-20)).toBe(levelToColor(0));
  });

  it('produces well-formed hsl() strings across the whole range', () => {
    for (const pct of [0, 1, 9, 10, 11, 25, 49, 50, 51, 74, 75, 76, 99, 100]) {
      expect(levelToColor(pct)).toMatch(/^hsl\(-?[\d.]+, [\d.]+%, [\d.]+%\)$/);
    }
  });
});
