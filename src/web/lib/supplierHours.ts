import {
  DAY_KEYS, emptyDays, type DayKey, type DayHours, type SupplierHours,
} from '../../server/db/suppliers.js';

export { DAY_KEYS, emptyDays };
export type { DayKey, DayHours, SupplierHours };

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** A blank structured week — every day closed, no note. */
export function blankHours(): SupplierHours {
  return { note: null, days: emptyDays() };
}

/** `"09:00"` -> `"9 AM"`, `"17:30"` -> `"5:30 PM"`. Minutes are dropped when :00 so a
 *  whole-hour week reads as "9 AM–5 PM" rather than "9:00 AM–5:00 PM". */
export function formatTime(hhmm: string): string {
  const hour = Number(hhmm.slice(0, 2));
  const minute = hhmm.slice(3, 5);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === '00' ? `${twelve} ${suffix}` : `${twelve}:${minute} ${suffix}`;
}

function sameRange(a: DayHours | null, b: DayHours | null): boolean {
  if (a == null || b == null) return a === b;
  return a.open === b.open && a.close === b.close;
}

export interface HoursRun {
  /** `"Mon–Fri"` for a multi-day run, `"Sat"` for one day. */
  days: string;
  /** `"9 AM–5 PM"`, or `"Closed"` for a closed run. */
  hours: string;
}

/**
 * Compresses the week into runs of consecutive days sharing the same range —
 * `Mon–Fri 9 AM–5 PM · Sat 10 AM–2 PM · Sun Closed`. Returns [] when no day has hours
 * set (a legacy note-only supplier has nothing structured to show).
 */
export function hoursRuns(hours: SupplierHours | null): HoursRun[] {
  if (hours == null) return [];
  if (!DAY_KEYS.some((k) => hours.days[k] != null)) return [];
  const runs: HoursRun[] = [];
  let start = 0;
  for (let i = 1; i <= DAY_KEYS.length; i += 1) {
    const prev = hours.days[DAY_KEYS[i - 1]!];
    const cur = i < DAY_KEYS.length ? hours.days[DAY_KEYS[i]!] : undefined;
    if (cur !== undefined && sameRange(prev, cur)) continue;
    const first = DAY_LABELS[DAY_KEYS[start]!];
    const last = DAY_LABELS[DAY_KEYS[i - 1]!];
    runs.push({
      days: start === i - 1 ? first : `${first}–${last}`,
      hours: prev == null ? 'Closed' : `${formatTime(prev.open)}–${formatTime(prev.close)}`,
    });
    start = i;
  }
  return runs;
}

/** One-line summary for compact surfaces: `"Mon–Fri 9 AM–5 PM · Sat 10 AM–2 PM"`. */
export function formatHoursSummary(hours: SupplierHours | null): string {
  return hoursRuns(hours).map((r) => `${r.days} ${r.hours}`).join(' · ');
}

/** `Date.getDay()` (0 = Sunday) mapped onto our Monday-first key order. */
function dayKeyFor(date: Date): DayKey {
  return DAY_KEYS[(date.getDay() + 6) % 7]!;
}

/**
 * Whether the supplier is open at `now` (the viewer's local clock — a supplier's hours are
 * wall-clock hours where they are, and the tablet lives in the same place). Returns null
 * when there's nothing structured to judge, so callers can hide the badge entirely rather
 * than claiming a legacy note-only supplier is closed.
 */
export function isOpenAt(hours: SupplierHours | null, now: Date): boolean | null {
  if (hoursRuns(hours).length === 0) return null;
  const today = hours!.days[dayKeyFor(now)];
  if (today == null) return false;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= today.open && hhmm < today.close;
}
