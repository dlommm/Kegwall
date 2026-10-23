import { serviceDayStart } from '../../server/core/serviceDay.js';

export interface HourBar {
  /** Hours since the service day began (unique, even when a DST night repeats a clock hour). */
  offset: number;
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
  // Buckets are real elapsed hours from the start, so a daylight-saving night has 23 or 25
  // of them, and each is labelled by the local clock hour it actually began at.
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const hours = Math.round((end.getTime() - start.getTime()) / 3_600_000);
  const offsetOf = (d: Date) => Math.floor((d.getTime() - start.getTime()) / 3_600_000);
  const hourAt = (off: number) => new Date(start.getTime() + off * 3_600_000).getHours();
  const counts = new Array<number>(hours).fill(0);
  for (const ts of pourTimes) {
    const off = offsetOf(new Date(ts));
    if (off >= 0 && off < hours) counts[off]! += 1;
  }
  const last = hours - 1;
  const nowOff = Math.min(last, Math.max(0, offsetOf(now)));
  const firstPour = counts.findIndex((c) => c > 0);
  const evening = EVENING_START_HOUR - start.getHours();
  const from = Math.min(evening, firstPour === -1 ? evening : firstPour, nowOff);
  const to = Math.min(last, Math.max(nowOff, from + MIN_BARS - 1));
  const bars: HourBar[] = [];
  for (let off = from; off <= to; off += 1) {
    const hour = hourAt(off);
    bars.push({
      offset: off, hour, label: hourLabel(hour), pours: counts[off]!, isNow: off === nowOff,
    });
  }
  return bars;
}
