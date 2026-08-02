// Days-to-kick forecast presentation (WebUI redesign 3b/3d). The server already computes each
// active keg's `projectedKickDate` (db/stats.ts `activeKegStats`, from the trailing-7-day burn
// rate); these helpers turn that into the "kicks in ~N days" copy + the ≤3-day danger state the
// dashboard TAPS card and the Taps page both show. Pure + `now`-injectable for tests.

/** Danger threshold: at or below this many days to kick, the forecast reads red (design 3b/3d). */
export const KICK_SOON_DAYS = 3;

/** Whole days from `now` until `projectedKickDate` (`YYYY-MM-DD`), or null when unknown. Never
 * negative — a past/na date reads as 0 ("kicks today"). */
export function kicksInDays(projectedKickDate: string | null, now: Date = new Date()): number | null {
  if (!projectedKickDate) return null;
  const target = new Date(`${projectedKickDate}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((target - startOfToday) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

/** "kicks ~today" / "kicks in ~1 day" / "kicks in ~N days", or null when there's no projection. */
export function kicksInLabel(projectedKickDate: string | null, now: Date = new Date()): string | null {
  const d = kicksInDays(projectedKickDate, now);
  if (d === null) return null;
  if (d === 0) return 'kicks ~today';
  if (d === 1) return 'kicks in ~1 day';
  return `kicks in ~${d} days`;
}

/** True when the keg is projected to kick within KICK_SOON_DAYS (the red state). */
export function kicksSoon(projectedKickDate: string | null, now: Date = new Date()): boolean {
  const d = kicksInDays(projectedKickDate, now);
  return d !== null && d <= KICK_SOON_DAYS;
}
