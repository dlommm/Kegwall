import type { PoursByDay } from '../lib/adminApi';

// TODAY'S POURS trend (WebUI redesign 3b). Turns the server's zero-filled per-day pour
// series (getPoursByDay) into a 7-bar mini chart plus a week-over-week delta ("↑ 12% vs
// last Friday"). Real data only — the delta compares today to the SAME WEEKDAY last week,
// which is why the caller fetches a 30-day window (the 7-day window can't reach back 7 days).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface TrendBar {
  date: string;
  count: number;
  isToday: boolean;
}

export interface PoursTrend {
  /** The last 7 days, oldest first; the final bar is today. */
  bars: TrendBar[];
  /** Today vs the same weekday last week, as a whole-number percent. Null when last
   *  week's matching day had no pours (nothing to divide by) or the window is too short. */
  deltaPct: number | null;
  /** e.g. "vs last Friday" — the weekday of today (== the comparison day). */
  comparisonLabel: string;
}

/**
 * @param byDay  Oldest-first, zero-filled per-day series from getPoursByDay (any length ≥ 1).
 *               A 30-day window is needed for a non-null delta; a 7-day window still yields bars.
 */
export function buildPoursTrend(byDay: PoursByDay[]): PoursTrend {
  const bars: TrendBar[] = byDay.slice(-7).map((d, i, arr) => ({
    date: d.date, count: d.count, isToday: i === arr.length - 1,
  }));

  const today = byDay[byDay.length - 1];
  const weekAgo = byDay.length >= 8 ? byDay[byDay.length - 8] : undefined;

  const deltaPct = today && weekAgo && weekAgo.count > 0
    ? Math.round(((today.count - weekAgo.count) / weekAgo.count) * 100)
    : null;

  // Parse as UTC (the series' days are UTC calendar days) so the weekday name matches the bucket.
  const weekday = today ? WEEKDAYS[new Date(`${today.date}T00:00:00Z`).getUTCDay()] : '';
  return { bars, deltaPct, comparisonLabel: `vs last ${weekday}` };
}
