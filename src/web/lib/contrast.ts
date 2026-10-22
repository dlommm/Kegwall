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
