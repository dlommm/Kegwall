import { describe, expect, it } from 'vitest';
import { serviceDayStart } from '../../src/server/core/serviceDay.js';

describe('serviceDayStart (Kegwall V2 "tonight")', () => {
  it('starts at 04:00 local on the same day after 4 am', () => {
    const start = serviceDayStart(new Date(2026, 9, 22, 21, 30));
    expect(start).toEqual(new Date(2026, 9, 22, 4, 0));
  });

  it('keeps 1 am on the previous night', () => {
    const start = serviceDayStart(new Date(2026, 9, 23, 1, 15));
    expect(start).toEqual(new Date(2026, 9, 22, 4, 0));
  });

  it('rolls over exactly at 04:00', () => {
    expect(serviceDayStart(new Date(2026, 9, 23, 4, 0))).toEqual(new Date(2026, 9, 23, 4, 0));
  });
});
