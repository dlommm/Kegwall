import { CLEANING_INTERVAL_DAYS, CLEANING_INTERVAL_GALLONS } from '../../server/db/cleanings.js';
import type { CleaningStatus } from '../../server/db/cleanings.js';

// Presentational meters for the Taps page keg cards (WebUI redesign 3d). Both are pure and
// derived from real data — the cleaning meter mirrors the server's whichever-comes-first due
// rule, and the kick timeline positions "now" between the tapped date and the projected kick.

/**
 * 0..1 progress toward the next line cleaning — the further-along of gallons-poured and
 * days-elapsed, matching `cleaningStatus`'s "15 gal OR 28 days, whichever first" due rule.
 * A never-cleaned line with pours reads as fully due (1).
 */
export function cleaningProgress(status: CleaningStatus): number {
  if (status.lastCleanedAt === null && status.gallonsSince > 0) return 1;
  const byGallons = status.gallonsSince / CLEANING_INTERVAL_GALLONS;
  const byDays = (status.daysSince ?? 0) / CLEANING_INTERVAL_DAYS;
  return Math.min(1, Math.max(0, Math.max(byGallons, byDays)));
}

/**
 * 0..100 position of `now` on the tapped → projected-kick timeline. Null when either
 * endpoint is missing or the projection isn't after the tap. Clamped, so a keg already past
 * its projection pins at 100.
 */
export function kickTimelinePct(
  dateTapped: string | null,
  projectedKickDate: string | null,
  now: Date = new Date(),
): number | null {
  if (!dateTapped || !projectedKickDate) return null;
  const start = new Date(dateTapped).getTime();
  const end = new Date(`${projectedKickDate}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const pct = ((now.getTime() - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}
