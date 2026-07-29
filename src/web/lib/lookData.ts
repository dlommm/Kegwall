import type { TapState } from '../../server/core/state.js';
import { matchKegType, type KegAssetId } from './kegAssets';
import { formatVolumeMl, type VolumeUnits } from './units';

/**
 * Shared per-tap view model for the wall LOOKS (Ledger/Gallery/Columns…).
 * Each look renders the same derived facts "in its own voice", so the
 * derivations live here once: level/status, poured vs. remaining, badge
 * states, and the brewing-figure estimates the Ledger's data cells show.
 *
 * Estimated figures (all null when the beer has no ABV):
 *  - kcal per 12 oz ≈ ABV × 30 — the standard rule-of-thumb calorie
 *    approximation (alcohol + residual carbs), and exactly the mapping the
 *    design document's mock data uses.
 *  - OG ≈ 1 + ABV/131.25 + 0.012 — the ABV formula (ABV = (OG−FG)×131.25)
 *    inverted around a typical finishing gravity of 1.012.
 *  - BU:GU = IBU / ((OG−1)×1000) — bitterness-to-gravity ratio.
 */

export type TapStatus = 'ok' | 'warn' | 'danger';

/** A keg tapped within this many days wears the NEW ON TAP badge. */
export const NEW_BADGE_DAYS = 7;
/** At or below this level % the ALMOST GONE badge shows (== danger threshold). */
export const LOW_BADGE_PCT = 15;

const ML_PER_US_FL_OZ = 29.5735295625;
const ML_PER_PINT = 473.176;
const ML_PER_METRIC_POUR = 500;

export interface TapLookModel {
  tap: TapState;
  tapNumber: number;
  name: string | null;
  style: string | null;
  brewery: string | null;
  notes: string | null;
  abv: number | null;
  ibu: number | null;
  srm: number | null;
  srmLabel: string | null;
  /** 0-100 (kicked kegs read as 0 — drained, matching TapCard's presentation). */
  levelPct: number;
  status: TapStatus;
  kegType: KegAssetId | null;
  /** "1,171 oz poured" / "34.6 L poured" style whole-volume labels. */
  pouredLabel: string | null;
  remainingLabel: string | null;
  /** ≈ servings left: US pints (16 oz) or metric 500 mL pours. */
  servingsLeft: number | null;
  servingsNoun: string;
  kcal: number | null;
  ogLabel: string | null;
  buGuLabel: string | null;
  isNew: boolean;
  isLow: boolean;
  isKicked: boolean;
  pouring: boolean;
  /** Live pour readout ("12.4 oz") while pouring. */
  pourLabel: string | null;
  hasBeer: boolean;
}

/** Level % → status bucket (≤15 danger, ≤35 warn, else ok — design thresholds). */
export function levelStatus(levelPct: number): TapStatus {
  if (levelPct <= 15) return 'danger';
  if (levelPct <= 35) return 'warn';
  return 'ok';
}

/** Whole-unit volume label for poured/remaining totals: whole oz with grouping
 * for US ("1,171 oz"), tenth-liters for metric ("34.6 L"). */
export function formatWholeVolume(ml: number, units: VolumeUnits): string {
  const safeMl = Number.isFinite(ml) ? Math.max(0, ml) : 0;
  if (units === 'metric') {
    return `${(safeMl / 1000).toFixed(1)} L`;
  }
  return `${Math.round(safeMl / ML_PER_US_FL_OZ).toLocaleString('en-US')} oz`;
}

function isNewOnTap(dateTapped: string | null, now: Date): boolean {
  if (!dateTapped) return false;
  const tapped = new Date(dateTapped).getTime();
  if (Number.isNaN(tapped)) return false;
  return now.getTime() - tapped <= NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
}

/** Build the look view model for one tap. `now` is injectable for tests. */
export function tapLookModel(tap: TapState, units: VolumeUnits, now: Date = new Date()): TapLookModel {
  const { beer, keg } = tap;
  const isKicked = keg?.status === 'kicked';
  const levelPct = keg ? (isKicked ? 0 : Math.round(keg.levelPct)) : 0;
  const remainingMl = keg && !isKicked ? keg.remainingMl : 0;
  const abv = beer?.abv ?? null;
  const ibu = beer?.ibu ?? null;

  const kcal = abv != null ? Math.round(abv * 30) : null;
  const og = abv != null ? 1 + abv / 131.25 + 0.012 : null;
  const buGu = og != null && ibu != null ? ibu / ((og - 1) * 1000) : null;

  const perServing = units === 'metric' ? ML_PER_METRIC_POUR : ML_PER_PINT;

  return {
    tap,
    tapNumber: tap.tapNumber,
    name: beer?.name ?? null,
    style: beer?.style ?? null,
    brewery: beer?.brewery ?? null,
    notes: beer?.description ?? null,
    abv,
    ibu,
    srm: beer?.srm ?? null,
    srmLabel: beer?.srm != null ? beer.srm.toFixed(1) : null,
    levelPct,
    status: levelStatus(levelPct),
    kegType: keg ? keg.kegType ?? matchKegType(keg.sizeMl) : null,
    pouredLabel: keg ? formatWholeVolume(keg.volDispensedMl, units) : null,
    remainingLabel: keg ? formatWholeVolume(remainingMl, units) : null,
    servingsLeft: keg ? Math.round(remainingMl / perServing) : null,
    servingsNoun: units === 'metric' ? 'pours' : 'pints',
    kcal,
    ogLabel: og != null ? og.toFixed(3) : null,
    buGuLabel: buGu != null ? buGu.toFixed(2) : null,
    isNew: !isKicked && isNewOnTap(keg?.dateTapped ?? null, now),
    isLow: !isKicked && !!keg && levelPct <= LOW_BADGE_PCT,
    isKicked,
    pouring: !isKicked && tap.pouring,
    pourLabel: !isKicked && tap.pouring && tap.curServMl != null
      ? formatVolumeMl(tap.curServMl, units)
      : null,
    hasBeer: !!beer && !!keg,
  };
}
