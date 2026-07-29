import halfBarrelSrc from '../assets/kegs/half-barrel.png';
import quarterBarrelSrc from '../assets/kegs/quarter-barrel.png';
import sixthBarrelSrc from '../assets/kegs/sixth-barrel.png';
import fiftyLiterSrc from '../assets/kegs/fifty-liter.png';
import corneliusSrc from '../assets/kegs/cornelius.png';
import slimQuarterSrc from '../assets/kegs/slim-quarter.png';
import miniKegSrc from '../assets/kegs/mini-keg.png';

/**
 * The 7 user-supplied cutaway keg photos (`keg-volume-asset/` at the repo root, copied
 * into `assets/kegs/` with clean names -- see that directory's own originals for the
 * source filenames). Each is a photorealistic cutaway with a visible empty interior
 * cavity, gauge markings printed on the interior back wall, and a baked-in caption
 * ("1/2 Barrel / Full Size / 15.5 Gallons" etc.) across the bottom of the photo.
 *
 * This list is also the single source of truth for the id strings used by:
 *  - `kegs.keg_type`'s CHECK constraint (migration 005 -- kept in sync by hand, same as
 *    `KegStatus` vs. `kegs.status`'s CHECK already are)
 *  - the swap wizard / on-deck "Keg type" select's option list
 *  - `db/kegs.ts`'s `KegType` union
 * If you add/rename/remove an asset here, update those three by hand too.
 */
export const KEG_ASSET_IDS = [
  'half-barrel', 'quarter-barrel', 'sixth-barrel', 'fifty-liter', 'cornelius', 'slim-quarter', 'mini-keg',
] as const;
export type KegAssetId = typeof KEG_ASSET_IDS[number];

/** Percentages of the CROPPED display box (i.e. after `crop.keepPct` has already cut the
 * caption band off the bottom -- see `KegFill.tsx`), not of the original photo. `top`/
 * `bottom`/`left`/`right` are the cavity's edges as a percent of the crop box's own
 * height/width; `borderRadius` softens the cavity rect's corners (also a percent, applied
 * uniformly). Hand-tuned against real Chromium screenshots -- see the Task report for the
 * per-asset verification pass. */
export interface KegCavityGeometry {
  top: number;
  bottom: number;
  left: number;
  right: number;
  borderRadius: number;
}

export interface KegAsset {
  id: KegAssetId;
  label: string;
  /** The physical keg size this asset depicts, in mL -- the value `matchKegType` compares
   * a keg's own `sizeMl` against. */
  volumeMl: number;
  src: string;
  /** Natural pixel dimensions of the source PNG (`sips -g pixelWidth -g pixelHeight`),
   * used only to size the display box's `aspect-ratio`. */
  width: number;
  height: number;
  /** Percent of the ORIGINAL photo's height to keep, measured from the top -- crops the
   * baked-in caption text off the bottom (see `KegFill.tsx`'s doc comment for why crop
   * rather than just overlay/hide it: the card already shows keg size as text elsewhere,
   * so the caption is pure redundant clutter once cropped in-frame). */
  cropPct: number;
  cavity: KegCavityGeometry;
}

export const KEG_ASSETS: Record<KegAssetId, KegAsset> = {
  'half-barrel': {
    id: 'half-barrel',
    label: '1/2 Barrel (Full Size, 15.5 gal)',
    volumeMl: 58674,
    src: halfBarrelSrc,
    width: 253,
    height: 561,
    cropPct: 79,
    cavity: {
      top: 19, bottom: 93.7, left: 31, right: 16, borderRadius: 8,
    },
  },
  'quarter-barrel': {
    id: 'quarter-barrel',
    label: '1/4 Barrel (Stubby, 7.75 gal)',
    volumeMl: 29337,
    src: quarterBarrelSrc,
    width: 220,
    height: 498,
    cropPct: 76,
    cavity: {
      top: 22.4, bottom: 90.8, left: 29, right: 14, borderRadius: 8,
    },
  },
  'sixth-barrel': {
    id: 'sixth-barrel',
    label: '1/6 Barrel (Torpedo, 5.16 gal)',
    volumeMl: 19558,
    src: sixthBarrelSrc,
    width: 176,
    height: 531,
    cropPct: 77,
    cavity: {
      top: 20.8, bottom: 93.5, left: 30, right: 15, borderRadius: 8,
    },
  },
  'fifty-liter': {
    id: 'fifty-liter',
    label: '50 Liter (Import, 13.2 gal)',
    volumeMl: 50000,
    src: fiftyLiterSrc,
    width: 225,
    height: 531,
    cropPct: 77,
    cavity: {
      top: 19.5, bottom: 90.9, left: 31, right: 15, borderRadius: 8,
    },
  },
  cornelius: {
    id: 'cornelius',
    label: 'Cornelius Keg (Corny, 5.0 gal)',
    volumeMl: 18927,
    src: corneliusSrc,
    width: 158,
    height: 498,
    cropPct: 76,
    cavity: {
      top: 17.1, bottom: 93.4, left: 25, right: 12, borderRadius: 10,
    },
  },
  'slim-quarter': {
    id: 'slim-quarter',
    label: 'Slim Quarter (Tall, 7.75 gal)',
    volumeMl: 29337,
    src: slimQuarterSrc,
    width: 157,
    height: 533,
    cropPct: 76,
    cavity: {
      top: 19.7, bottom: 94.7, left: 30, right: 15, borderRadius: 8,
    },
  },
  'mini-keg': {
    id: 'mini-keg',
    label: 'Mini Keg (5 Liter, 1.32 gal)',
    volumeMl: 5000,
    src: miniKegSrc,
    width: 155,
    height: 365,
    cropPct: 72,
    cavity: {
      top: 33, bottom: 88.9, left: 38, right: 24, borderRadius: 8,
    },
  },
};

/**
 * Auto-selects the nearest asset to a keg's declared `sizeMl` (nearest by absolute
 * difference in `volumeMl`). Ties are broken by `KEG_ASSET_IDS` order -- the only tie in
 * the table is 29337 mL (quarter-barrel vs. slim-quarter, both a genuine 7.75-gallon
 * keg), and `quarter-barrel` sorts first, matching the spec's explicit call: "ambiguous
 * volumes default to '1:4 Barrel'".
 */
export function matchKegType(sizeMl: number): KegAssetId {
  let best: KegAssetId = KEG_ASSET_IDS[0];
  let bestDiff = Infinity;
  for (const id of KEG_ASSET_IDS) {
    const diff = Math.abs(KEG_ASSETS[id].volumeMl - sizeMl);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return best;
}

/**
 * Resolves the asset `KegFill` should render for a keg: an explicit `override` (the
 * keg's `keg_type` column -- see migration 005) wins whenever it names a real asset;
 * otherwise falls back to `matchKegType(sizeMl)`. A stale/unrecognized override (schema
 * drift, hand-edited DB) degrades to the auto-match rather than throwing.
 */
export function resolveKegAsset(sizeMl: number, override: KegAssetId | null | undefined): KegAsset {
  const id = override && (KEG_ASSET_IDS as readonly string[]).includes(override)
    ? override
    : matchKegType(sizeMl);
  return KEG_ASSETS[id];
}
