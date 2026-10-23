import { serviceDayStart } from '../../server/core/serviceDay.js';

export interface HourBar {
  /** Local hour 0-23. */
  hour: number;
  /** "4 PM", "12 AM". */
  label: string;
  pours: number;
  isNow: boolean;
}

/** The evening the chart starts at when nothing was poured earlier (4 PM). */
const EVENING_START_HOUR = 16;
/** Never fewer bars than this, so a quiet early evening still reads as a timeline. */
const MIN_BARS = 9;

export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Pours per hour across tonight's service day (04:00 to 04:00, like the wall's "tonight").
 * The chart runs from 4 PM, or from the first pour's hour if that was earlier, to at least the
 * current hour, padded to nine bars where the night allows.
 */
export function tonightHours(pourTimes: string[], now: Date = new Date()): HourBar[] {
  const start = serviceDayStart(now);
  const offsetOf = (d: Date) => Math.floor((d.getTime() - start.getTime()) / 3_600_000);
  const counts = new Array<number>(24).fill(0);
  for (const ts of pourTimes) {
    const off = offsetOf(new Date(ts));
    if (off >= 0 && off < 24) counts[off]! += 1;
  }
  const nowOff = Math.min(23, Math.max(0, offsetOf(now)));
  const firstPour = counts.findIndex((c) => c > 0);
  const evening = EVENING_START_HOUR - start.getHours();
  const from = Math.min(evening, firstPour === -1 ? evening : firstPour, nowOff);
  const to = Math.min(23, Math.max(nowOff, from + MIN_BARS - 1));
  const bars: HourBar[] = [];
  for (let off = from; off <= to; off += 1) {
    const hour = (start.getHours() + off) % 24;
    bars.push({ hour, label: hourLabel(hour), pours: counts[off]!, isNow: off === nowOff });
  }
  return bars;
}
