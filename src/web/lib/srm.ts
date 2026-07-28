/**
 * SRM (Standard Reference Method) is the standard scale for describing US beer
 * color, running roughly 1 (pale straw lager) to 40+ (opaque stout/porter black).
 * This module maps an SRM value to the liquid tint used by the wall's SRM-true
 * liquid fill (see the "Visual design direction" section of the Phase 3 plan).
 *
 * The whole-SRM-step reference hex values below are the color table shipped by
 * Barley Dog Brewery and consumed as the color source by the open-source
 * `chromabrew` beer-color library (https://github.com/Zymulator/chromabrew):
 *   https://www.barleydogbrewery.com/xml/colors.xml
 *
 * Fractional SRM values are linearly interpolated between the two nearest
 * whole-step entries. Values are clamped to the table's 1-40 domain (beyond 40
 * the color is already visually indistinguishable near-black, per the AHA/BJCP
 * convention of capping the SRM scale at "40+").
 */

/** liquidResult.liquid / liquidResult.highlight are always "#rrggbb" (uppercase hex). */
export interface SrmColor {
  /** The body color of the liquid fill. */
  liquid: string;
  /** A lightened variant of `liquid`, used for the surface/foam-line highlight. */
  highlight: string;
}

// Index 0 holds SRM 1, index 39 holds SRM 40.
const SRM_HEX: readonly string[] = [
  '#F3F993', // SRM 1
  '#F8F753', // SRM 2
  '#F6F513', // SRM 3
  '#ECE61A', // SRM 4
  '#E0D01B', // SRM 5
  '#D5BC26', // SRM 6
  '#C9A732', // SRM 7
  '#BF923B', // SRM 8
  '#BE8C3A', // SRM 9
  '#BF813A', // SRM 10
  '#BE7C37', // SRM 11
  '#BF7138', // SRM 12
  '#BC6733', // SRM 13
  '#B26033', // SRM 14
  '#A55936', // SRM 15
  '#985336', // SRM 16
  '#8D4C32', // SRM 17
  '#7C452D', // SRM 18
  '#6B3A1E', // SRM 19
  '#5D341A', // SRM 20
  '#4E2A0C', // SRM 21
  '#4A2727', // SRM 22
  '#361F1B', // SRM 23
  '#261716', // SRM 24
  '#261716', // SRM 25
  '#19100F', // SRM 26
  '#19100F', // SRM 27
  '#120D0C', // SRM 28
  '#100B0A', // SRM 29
  '#100B0A', // SRM 30
  '#0E0908', // SRM 31
  '#0F0B08', // SRM 32
  '#0C0907', // SRM 33
  '#080707', // SRM 34
  '#080707', // SRM 35
  '#070606', // SRM 36
  '#040504', // SRM 37
  '#040504', // SRM 38
  '#030403', // SRM 39
  '#030403', // SRM 40
];

const MIN_SRM = 1;
const MAX_SRM = SRM_HEX.length; // 40

/**
 * No beer selected / SRM unknown: render a neutral amber consistent with the
 * SRM scale itself (rather than an arbitrary off-scale color), roughly in the
 * middle of the common "pale ale / amber" band.
 */
const DEFAULT_SRM = 9;

/** How far toward white the liquid color is pushed to produce its surface highlight. */
const HIGHLIGHT_MIX_TOWARD_WHITE = 0.3;

function clampSrm(srm: number): number {
  if (Number.isNaN(srm)) return DEFAULT_SRM;
  return Math.min(MAX_SRM, Math.max(MIN_SRM, srm));
}

/** 1-based SRM step (1-40) -> table hex. */
function hexForStep(step: number): string {
  return SRM_HEX[step - 1] ?? SRM_HEX[0] ?? '#000000';
}

function colorForSrm(value: number): string {
  const low = Math.floor(value);
  const high = Math.ceil(value);
  const lowHex = hexForStep(low);
  if (low === high) return lowHex;
  const highHex = hexForStep(high);
  const t = value - low;
  return mixHex(lowHex, highHex, t);
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function channelToHex(channel: number): string {
  return Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0').toUpperCase();
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/** Linearly interpolate between two hex colors; t=0 -> a, t=1 -> b. */
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Push a color toward white by `amount` (0-1) — used for the liquid surface highlight. */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => channel + (255 - channel) * amount;
  return rgbToHex(mix(r), mix(g), mix(b));
}

/**
 * Map an SRM value to the liquid + highlight colors used by the wall's
 * SRM-true liquid fill. `srm` is clamped to the reference table's 1-40 domain;
 * `null` (no beer / unknown color) renders a neutral amber default.
 */
export function srmToColor(srm: number | null): SrmColor {
  const value = srm === null ? DEFAULT_SRM : clampSrm(srm);
  const liquid = colorForSrm(value);
  const highlight = lighten(liquid, HIGHLIGHT_MIX_TOWARD_WHITE);
  return { liquid, highlight };
}
