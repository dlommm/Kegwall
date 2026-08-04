import { describe, it, expect } from 'vitest';
import {
  blankHours, emptyDays, formatHoursSummary, formatTime, hoursRuns, isOpenAt,
  type SupplierHours,
} from '../../src/web/lib/supplierHours';

function week(days: Partial<SupplierHours['days']>): SupplierHours {
  return { note: null, days: { ...emptyDays(), ...days } };
}

const NINE_TO_FIVE = { open: '09:00', close: '17:00' };

describe('supplier hours formatting', () => {
  it('drops :00 minutes so a whole-hour week reads plainly', () => {
    expect(formatTime('09:00')).toBe('9 AM');
    expect(formatTime('17:30')).toBe('5:30 PM');
    expect(formatTime('00:15')).toBe('12:15 AM');
    expect(formatTime('12:00')).toBe('12 PM');
  });

  it('collapses consecutive days that share a range into one run', () => {
    const hours = week({
      mon: NINE_TO_FIVE, tue: NINE_TO_FIVE, wed: NINE_TO_FIVE, thu: NINE_TO_FIVE, fri: NINE_TO_FIVE,
      sat: { open: '10:00', close: '14:00' },
    });
    expect(hoursRuns(hours)).toEqual([
      { days: 'Mon–Fri', hours: '9 AM–5 PM' },
      { days: 'Sat', hours: '10 AM–2 PM' },
      { days: 'Sun', hours: 'Closed' },
    ]);
    expect(formatHoursSummary(hours)).toBe('Mon–Fri 9 AM–5 PM · Sat 10 AM–2 PM · Sun Closed');
  });

  it('has nothing structured to show for a legacy note-only supplier', () => {
    expect(hoursRuns({ note: 'Mon-Fri 9-5', days: emptyDays() })).toEqual([]);
    expect(hoursRuns(null)).toEqual([]);
    expect(hoursRuns(blankHours())).toEqual([]);
  });
});

describe('isOpenAt', () => {
  const hours = week({ mon: NINE_TO_FIVE, sat: { open: '10:00', close: '14:00' } });

  it('is open inside the day’s range and closed outside it', () => {
    // 2026-08-03 is a Monday; these are local-clock times.
    expect(isOpenAt(hours, new Date(2026, 7, 3, 12, 0))).toBe(true);
    expect(isOpenAt(hours, new Date(2026, 7, 3, 8, 59))).toBe(false);
    expect(isOpenAt(hours, new Date(2026, 7, 3, 17, 0))).toBe(false); // closing time is the edge
  });

  it('is closed on a day with no hours set', () => {
    expect(isOpenAt(hours, new Date(2026, 7, 4, 12, 0))).toBe(false); // Tuesday
  });

  it('reads the right day for Sunday, which JS numbers as 0', () => {
    const sundayOnly = week({ sun: NINE_TO_FIVE });
    expect(isOpenAt(sundayOnly, new Date(2026, 7, 2, 12, 0))).toBe(true);
    expect(isOpenAt(sundayOnly, new Date(2026, 7, 3, 12, 0))).toBe(false);
  });

  it('declines to judge a supplier with no structured week', () => {
    expect(isOpenAt({ note: 'call ahead', days: emptyDays() }, new Date(2026, 7, 3, 12, 0))).toBeNull();
    expect(isOpenAt(null, new Date(2026, 7, 3, 12, 0))).toBeNull();
  });
});
