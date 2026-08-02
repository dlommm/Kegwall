import { describe, it, expect } from 'vitest';
import { kicksInDays, kicksInLabel, kicksSoon, KICK_SOON_DAYS } from '../../src/web/lib/kegForecast';

const NOW = new Date('2026-08-02T14:00:00'); // local

describe('kegForecast', () => {
  it('kicksInDays: whole days to the projected date, floored at 0, null when unknown', () => {
    expect(kicksInDays('2026-08-04', NOW)).toBe(2);
    expect(kicksInDays('2026-08-02', NOW)).toBe(0);
    expect(kicksInDays('2026-07-30', NOW)).toBe(0); // past → clamps to 0
    expect(kicksInDays(null, NOW)).toBeNull();
    expect(kicksInDays('not-a-date', NOW)).toBeNull();
  });

  it('kicksInLabel: friendly copy with singular/plural + today', () => {
    expect(kicksInLabel('2026-08-02', NOW)).toBe('kicks ~today');
    expect(kicksInLabel('2026-08-03', NOW)).toBe('kicks in ~1 day');
    expect(kicksInLabel('2026-08-09', NOW)).toBe('kicks in ~7 days');
    expect(kicksInLabel(null, NOW)).toBeNull();
  });

  it('kicksSoon: true within the danger window, false beyond, false when unknown', () => {
    expect(KICK_SOON_DAYS).toBe(3);
    expect(kicksSoon('2026-08-05', NOW)).toBe(true); // 3 days
    expect(kicksSoon('2026-08-06', NOW)).toBe(false); // 4 days
    expect(kicksSoon(null, NOW)).toBe(false);
  });
});
