/**
 * Shared data for the dynamic data glyphs (design handoff option 1d): glass
 * shapes + the beer-style → glassware mapping, the glyph render modes, and the
 * status color helper. All SVG path data is taken verbatim from the design
 * document's logic class (`Pour Wall Explorations.dc.html`) — every glyph
 * draws in a `0 0 60 80` viewBox.
 */

/** Wall-level glyph treatment (design 1d): `flat` = subtle body fill, `outline`
 * = stroke only, `duotone` = glass tinted by the beer's own color. */
export type GlyphMode = 'flat' | 'outline' | 'duotone';

export type GlassShape = 'pint' | 'nonic' | 'tulip' | 'flute' | 'goblet' | 'mug';

export interface GlassShapeDef {
  /** Outline path of the vessel bowl (also the liquid clip shape). */
  d: string;
  /** Y of the liquid surface when full / of the bowl bottom. */
  top: number;
  bot: number;
  /** Extra solid parts (stem/foot), drawn in the line color. */
  ex?: { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number }[];
  /** Extra stroked path (the mug handle). */
  stroke?: string;
}

export const GLASS_SHAPES: Record<GlassShape, GlassShapeDef> = {
  pint: { d: 'M15 6 L45 6 L41 74 L19 74 Z', top: 6, bot: 74 },
  nonic: { d: 'M16 6 L44 6 L43 24 Q48 31 43 38 L41.5 74 L18.5 74 L17 38 Q12 31 17 24 Z', top: 6, bot: 74 },
  tulip: {
    d: 'M17 6 Q23 20 19 30 Q15 40 25 45 L25 57 L35 57 L35 45 Q45 40 41 30 Q37 20 43 6 Z',
    top: 6,
    bot: 57,
    ex: [
      { kind: 'rect', x: 27.5, y: 57, width: 5, height: 12 },
      { kind: 'rect', x: 20, y: 69, width: 20, height: 4, rx: 2 },
    ],
  },
  flute: {
    d: 'M21 6 L39 6 L33.5 55 L26.5 55 Z',
    top: 6,
    bot: 55,
    ex: [
      { kind: 'rect', x: 28.5, y: 55, width: 3, height: 14 },
      { kind: 'rect', x: 20, y: 69, width: 20, height: 4, rx: 2 },
    ],
  },
  goblet: {
    d: 'M15 6 Q15 33 30 37 Q45 33 45 6 Z',
    top: 6,
    bot: 37,
    ex: [
      { kind: 'rect', x: 27.5, y: 37, width: 5, height: 32 },
      { kind: 'rect', x: 19, y: 69, width: 22, height: 4, rx: 2 },
    ],
  },
  mug: { d: 'M15 8 L43 8 L43 74 L15 74 Z', top: 8, bot: 74, stroke: 'M43 24 Q55 24 55 42 Q55 58 43 58' },
};

/** Style-keyword → glass shape rules, checked in order (first match wins).
 * Mapping per the handoff README §Dynamic glyphs: shaker pint = IPA/ale,
 * nonic = stout/porter, tulip = saison/wild, flute = pilsner/lager, goblet =
 * tripel/quad, mug = amber/oktoberfest. More specific keywords come before
 * broader ones so e.g. "Amber Ale" hits the mug rule, not the pint/ale rule. */
const STYLE_SHAPE_RULES: { pattern: RegExp; shape: GlassShape }[] = [
  { pattern: /stout|porter/i, shape: 'nonic' },
  { pattern: /saison|farmhouse|wild|sour|lambic|gose|brett/i, shape: 'tulip' },
  { pattern: /tripel|quad|dubbel|belgian strong|abbey/i, shape: 'goblet' },
  { pattern: /amber|oktoberfest|märzen|marzen|festbier|bock|dunkel|vienna/i, shape: 'mug' },
  { pattern: /pilsner|pilsener|pils|lager|kölsch|kolsch|helles/i, shape: 'flute' },
  { pattern: /ipa|pale ale|ale/i, shape: 'pint' },
];

/** Auto-select the glassware for a beer style (overridable per beer upstream);
 * unknown/missing styles default to the shaker pint. */
export function glassShapeForStyle(style: string | null | undefined): GlassShape {
  if (style) {
    for (const rule of STYLE_SHAPE_RULES) {
      if (rule.pattern.test(style)) return rule.shape;
    }
  }
  return 'pint';
}

/** Keg-level → status color token (thresholds per the design: ≤15% danger,
 * ≤35% warn, else ok). `frac` is 0-1. */
export function statusToken(frac: number): string {
  if (frac <= 0.15) return 'var(--danger)';
  if (frac <= 0.35) return 'var(--warn)';
  return 'var(--ok)';
}

/** The stroke/line color every glyph draws its outline and details in. Looks
 * set `--glyph-line` on their scope (typically a translucent mix of the
 * theme's text color); standalone renders fall back to `currentColor`. */
export const GLYPH_LINE = 'var(--glyph-line, currentColor)';
