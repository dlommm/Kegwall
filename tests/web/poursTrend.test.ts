import { describe, it, expect } from 'vitest';
import { buildPoursTrend } from '../../src/web/lib/poursTrend';
import type { PoursByDay } from '../../src/web/lib/adminApi';

function day(date: string, count: number): PoursByDay {
  return { date, count, volumeMl: count * 473 };
}

// 30 UTC days ending Fri 2026-07-31. index 29 = today (Fri), index 22 = same weekday last week.
function thirtyDays(todayCount: number, weekAgoCount: number): PoursByDay[] {
  const out: PoursByDay[] = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date('2026-07-31T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (29 - i));
    const iso = d.toISOString().slice(0, 10);
    out.push(day(iso, i === 29 ? todayCount : i === 22 ? weekAgoCount : 5));
  }
  return out;
}

describe('buildPoursTrend', () => {
  it('takes the last 7 days as bars and marks the final one today', () => {
    const trend = buildPoursTrend(thirtyDays(20, 16));
    expect(trend.bars).toHaveLength(7);
    expect(trend.bars[6]!.isToday).toBe(true);
    expect(trend.bars.slice(0, 6).every((b) => !b.isToday)).toBe(true);
    expect(trend.bars[6]!.count).toBe(20);
  });

  it('computes a week-over-week delta against the same weekday last week', () => {
    // 2026-07-31 is a Friday.
    const trend = buildPoursTrend(thirtyDays(20, 16));
    expect(trend.deltaPct).toBe(25); // (20-16)/16
    expect(trend.comparisonLabel).toBe('vs last Friday');
  });

  it('returns a null delta when last week had zero and still yields bars', () => {
    const trend = buildPoursTrend(thirtyDays(8, 0));
    expect(trend.deltaPct).toBeNull();
    expect(trend.bars).toHaveLength(7);
  });

  it('yields bars but a null delta from a short (7-day) window', () => {
    const week = Array.from({ length: 7 }, (_, i) => day(`2026-07-2${i + 1}`, i));
    const trend = buildPoursTrend(week);
    expect(trend.bars).toHaveLength(7);
    expect(trend.deltaPct).toBeNull();
  });
});
