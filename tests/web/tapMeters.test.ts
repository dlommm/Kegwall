import { describe, it, expect } from 'vitest';
import { cleaningProgress, kickTimelinePct } from '../../src/web/lib/tapMeters';
import type { CleaningStatus } from '../../src/server/db/cleanings';

function status(over: Partial<CleaningStatus>): CleaningStatus {
  return {
    tapId: 1, lastCleanedAt: '2026-07-01T00:00:00.000Z', gallonsSince: 0, daysSince: 0, due: false, ...over,
  };
}

describe('cleaningProgress', () => {
  it('takes the further-along of gallons (÷15) and days (÷28)', () => {
    // 7.5 gal → 0.5; 7 days → 0.25 → gallons win.
    expect(cleaningProgress(status({ gallonsSince: 7.5, daysSince: 7 }))).toBeCloseTo(0.5, 5);
    // 21 days → 0.75; 3 gal → 0.2 → days win.
    expect(cleaningProgress(status({ gallonsSince: 3, daysSince: 21 }))).toBeCloseTo(0.75, 5);
  });

  it('clamps to 1 and reads a never-cleaned line with pours as fully due', () => {
    expect(cleaningProgress(status({ gallonsSince: 30, daysSince: 5 }))).toBe(1);
    expect(cleaningProgress(status({ lastCleanedAt: null, gallonsSince: 2, daysSince: null }))).toBe(1);
  });
});

describe('kickTimelinePct', () => {
  it('positions now between the tapped date and the projected kick', () => {
    // Tapped Aug 1, kicks Aug 11, now Aug 3 → 20% elapsed.
    const pct = kickTimelinePct('2026-08-01T00:00:00.000Z', '2026-08-11', new Date('2026-08-03T00:00:00.000Z'));
    expect(pct).toBe(20);
  });

  it('clamps past-projection to 100 and returns null on missing/invalid endpoints', () => {
    expect(kickTimelinePct('2026-08-01T00:00:00.000Z', '2026-08-05', new Date('2026-09-01T00:00:00.000Z'))).toBe(100);
    expect(kickTimelinePct(null, '2026-08-05')).toBeNull();
    expect(kickTimelinePct('2026-08-01T00:00:00.000Z', null)).toBeNull();
  });
});
