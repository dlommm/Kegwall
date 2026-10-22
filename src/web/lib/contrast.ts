/**
 * WCAG 2 contrast math (Kegwall V2). A beer's own color is the only saturated color on a V2
 * wall, so every piece of text drawn on it (tap marker, Just Tapped spotlight field) picks
 * its ink by contrast instead of assuming light or dark. The contrast check script reuses
 * these functions so the rule and the test can't drift apart.
 */

/** `#rgb` / `#rrggbb` → [r, g, b] 0-255, or null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance of a hex color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1-21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const INK_DARK = '#141110';
export const INK_LIGHT = '#FFFFFF';

/** The ink (near-black or white) that reads best on `background`. */
export function pickInk(background: string): string {
  return contrastRatio(background, INK_DARK) >= contrastRatio(background, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

type Rgba = [number, number, number, number];

/** `#rgb`, `#rrggbb` or `rgb()/rgba()` → [r, g, b, a], or null. */
export function parseColor(color: string): Rgba | null {
  const hex = parseHex(color);
  if (hex) return [...hex, 1];
  const m = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (!m) return null;
  const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some((v) => Number.isNaN(v))) return null;
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
}

function toHex([r, g, b]: [number, number, number] | Rgba): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** A translucent color laid over an opaque one, as hex. */
export function flatten(top: string, under: string): string | null {
  const t = parseColor(top);
  const u = parseColor(under);
  if (!t || !u) return null;
  return toHex([0, 1, 2].map((i) => u[i]! + (t[i]! - u[i]!) * t[3]) as [number, number, number]);
}

/**
 * `fg` moved toward `toward` (the theme's main ink) just far enough to reach `min` contrast
 * against every background in `bgs`. Returns `fg` unchanged when it already passes, and null
 * when a color can't be parsed (the caller keeps its CSS fallback).
 */
export function ensureContrast(fg: string, bgs: string[], toward: string, min: number): string | null {
  const f = parseColor(fg);
  const t = parseColor(toward);
  if (!f || !t || bgs.some((b) => !parseHex(b))) return null;
  for (let step = 0; step <= 20; step++) {
    const k = step / 20;
    const c = toHex([0, 1, 2].map((i) => f[i]! + (t[i]! - f[i]!) * k) as [number, number, number]);
    if (bgs.every((b) => contrastRatio(c, b) >= min)) return c;
  }
  return toHex(t);
}
