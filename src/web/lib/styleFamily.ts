/**
 * The phone menu's style-family chips (Kegwall V2 decision D7): Light, Hoppy, Dark and Sour,
 * worked out on the phone from a beer's style text and color. No API change. A beer can sit
 * in no family (a cider, a mead, a style the words don't cover); it still shows under All.
 */
export type StyleFamily = 'light' | 'hoppy' | 'dark' | 'sour';

export const STYLE_FAMILIES: { id: StyleFamily; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'hoppy', label: 'Hoppy' },
  { id: 'dark', label: 'Dark' },
  { id: 'sour', label: 'Sour' },
];

// Checked in this order: a "Black IPA" is hoppy before it's dark, a "Sour IPA" sour first.
const SOUR = /\b(sour|gose|lambic|gueuze|geuze|kriek|framboise|berliner|flanders|wild|brett|oud bruin)\b/i;
const HOPPY = /\b(ipa|iipa|neipa|dipa|pale ale|apa|hazy|double ipa|triple ipa|hop|hoppy|bitter|esb)\b/i;
const DARK = /\b(stout|porter|schwarz|dunkel|doppelbock|bock|brown|black|baltic|mild|dubbel|quadrupel|quad|barleywine|scotch|wee heavy|rauch)\b/i;
const LIGHT = /\b(lager|pils|pilsner|pilsener|helles|kölsch|kolsch|blonde|blond|wheat|weiss|weizen|hefe|hefeweizen|witbier|wit|cream ale|light|cerveza|m[äa]rzen|vienna|saison|session|golden)\b/i;

/** Which family a beer reads as, from its style words, then its color for anything left. */
export function styleFamilyOf(style: string | null | undefined, srm: number | null | undefined): StyleFamily | null {
  const s = style ?? '';
  if (SOUR.test(s)) return 'sour';
  if (HOPPY.test(s)) return 'hoppy';
  if (DARK.test(s)) return 'dark';
  if (LIGHT.test(s)) return 'light';
  if (s.trim() === '' && srm != null) {
    if (srm >= 25) return 'dark';
    if (srm <= 6) return 'light';
  }
  return null;
}
