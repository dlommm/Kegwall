import type { TapState } from '../../server/core/state.js';
import { tapLookModel, type TapLookModel } from '../lib/lookData';
import { srmToColor, mixHex } from '../lib/srm';
import { pickInk } from '../lib/contrast';
import { kicksInDays } from '../lib/kegForecast';
import type { VolumeUnits } from '../lib/units';

/**
 * The per-tap view model every Kegwall V2 look reads. It extends the shared look model with
 * the V2 language: the beer's color as a field (and the ink that reads on it), a tap marker,
 * keg level in servings ("≈ 32 pints left"), tonight's pours and the kick forecast.
 */
export interface WallTapModel extends TapLookModel {
  /** The beer's SRM color, the only saturated color on a V2 wall. */
  beerColor: string;
  /** The beer's color pushed toward black: grounds and panels that belong to this beer. */
  deepTone: string;
  /** Near-black or white, whichever reads on `beerColor`. */
  markerInk: string;
  /** One or two letters for the tap marker ("CH" for Citra Haze). */
  markerLetters: string;
  /** Servings left in the keg, by the taproom's serving size; null with no keg. */
  servings: number | null;
  /** "pint" when the serving is a pint-sized pour (440-600 mL), otherwise "pour". */
  servingNoun: 'pint' | 'pour';
  /** "≈ 32 pints left", "Last pint", "Kicked" or "No keg". */
  servingsLabel: string;
  /** Whole days until the projected kick, or null when unknown / kicked. */
  kicksInDays: number | null;
  tonightPours: number;
  tonightMl: number;
  lastHourPours: number;
  /** Public price per pint in cents, present only when the owner turns prices on. */
  priceCents: number | null;
  /** Servings in a full keg of this size (for tallies), or null with no keg. */
  fullServings: number | null;
}

export interface WallModelOptions {
  units: VolumeUnits;
  /** One serving in mL (settings' `servingSizeMl`). */
  servingSizeMl: number;
  now?: Date;
}

const ARTICLES = new Set(['the', 'a', 'an']);

/** Up to two letters from a beer name, skipping a leading article ("The Long IPA" → "LI"). */
export function markerLettersFor(name: string | null): string {
  if (!name) return '';
  const words = name.trim().split(/[\s-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const meaningful = words.length > 1 && ARTICLES.has(words[0]!.toLowerCase()) ? words.slice(1) : words;
  return meaningful.slice(0, 2).map((w) => w.match(/[\p{L}\p{N}]/u)![0]!.toUpperCase()).join('');
}

export function servingNounFor(servingSizeMl: number): 'pint' | 'pour' {
  return servingSizeMl >= 440 && servingSizeMl <= 600 ? 'pint' : 'pour';
}

/** The bartender's phrasing of what's left. */
export function servingsLabelFor(
  servings: number | null, noun: 'pint' | 'pour', isKicked: boolean,
): string {
  if (isKicked) return 'Kicked';
  if (servings === null) return 'No keg';
  if (servings < 1) return servings <= 0 ? 'Empty' : `Last ${noun}`;
  const n = Math.round(servings);
  return `≈ ${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'} left`;
}

export function wallTapModel(tap: TapState, opts: WallModelOptions): WallTapModel {
  const now = opts.now ?? new Date();
  const base = tapLookModel(tap, opts.units, now);
  // The SRM table's palest steps (1-5) are highlighter yellows that read as UI color, not
  // beer, when they fill half a TV; a little warmth brings them back to straw.
  const srm = srmToColor(base.srm).liquid;
  const beerColor = base.srm != null && base.srm < 6 ? mixHex(srm, '#C8962E', 0.28) : srm;
  const remainingMl = tap.keg && !base.isKicked ? tap.keg.remainingMl : 0;
  const servings = tap.keg ? remainingMl / opts.servingSizeMl : null;
  const servingNoun = servingNounFor(opts.servingSizeMl);
  return {
    ...base,
    beerColor,
    deepTone: mixHex(beerColor, '#000000', 0.72),
    markerInk: pickInk(beerColor),
    markerLetters: markerLettersFor(base.name),
    servings: servings === null ? null : Math.round(servings * 10) / 10,
    servingNoun,
    servingsLabel: servingsLabelFor(servings, servingNoun, base.isKicked),
    kicksInDays: base.isKicked ? null : kicksInDays(tap.kickDate ?? null, now),
    tonightPours: tap.tonight?.pours ?? 0,
    tonightMl: tap.tonight?.volumeMl ?? 0,
    lastHourPours: tap.lastHourPours ?? 0,
    priceCents: (tap as TapState & { pricePerPintCents?: number | null }).pricePerPintCents ?? null,
    fullServings: tap.keg ? Math.floor(tap.keg.volStartMl / opts.servingSizeMl) : null,
  };
}
