/**
 * Traffic-light fill color for the keg cutaway overlay (`KegFill.tsx`): green at a full
 * keg, through yellow at the midpoint, to red as it runs dry — a level readable at a
 * glance from across a room, independent of the beer's own SRM color (unlike
 * `LiquidFill`'s SRM-true tint, `KegFill`'s cavity is a status indicator, not a color
 * sample of the beer).
 *
 * Three fixed anchors (spec'd exactly, not derived): 100% -> hsl(120, 70%, 45%) green,
 * 50% -> hsl(60, 75%, 50%) yellow, <=10% -> hsl(0, 75%, 50%) red. Between anchors, H/S/L
 * are all interpolated linearly (not hue-only) so the 100->50 leg's S/L glide from
 * 70/45 to 75/50 smoothly rather than jumping at the seam. Below the 10% anchor the
 * color is clamped flat at red — a near-empty keg doesn't get any redder.
 */

interface HslColor {
  h: number;
  s: number;
  l: number;
}

const GREEN_100: HslColor = { h: 120, s: 70, l: 45 };
const YELLOW_50: HslColor = { h: 60, s: 75, l: 50 };
const RED_10: HslColor = { h: 0, s: 75, l: 50 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHsl(a: HslColor, b: HslColor, t: number): HslColor {
  return { h: lerp(a.h, b.h, t), s: lerp(a.s, b.s, t), l: lerp(a.l, b.l, t) };
}

function formatHsl({ h, s, l }: HslColor): string {
  return `hsl(${round(h)}, ${round(s)}%, ${round(l)}%)`;
}

/** Rounded to 1 decimal place -- anchors are whole numbers so they print clean, while
 * interpolated midpoints still keep a little precision rather than banding visibly. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Maps a fill level (0-100) to its traffic-light HSL color; out-of-range input is
 * clamped. See the module doc comment above for the anchor spec. */
export function levelToColor(levelPct: number): string {
  const clamped = Math.max(0, Math.min(100, levelPct));

  if (clamped >= 100) return formatHsl(GREEN_100);
  if (clamped <= 10) return formatHsl(RED_10);
  if (clamped >= 50) {
    const t = (clamped - 50) / (100 - 50);
    return formatHsl(lerpHsl(YELLOW_50, GREEN_100, t));
  }
  const t = (clamped - 10) / (50 - 10);
  return formatHsl(lerpHsl(RED_10, YELLOW_50, t));
}
