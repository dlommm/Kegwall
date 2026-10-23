import { describe, expect, it } from 'vitest';
import { hourLabel, tonightHours } from '../../src/web/lib/tonightHours';
import {
  buildAttention, countWord, listJoin, tonightHeadline, type AttentionInput,
} from '../../src/web/lib/tonightAttention';

const at = (h: number, m = 0, day = 22) => new Date(2026, 9, day, h, m);

describe('tonightHours', () => {
  it('labels hours the way a bar reads a clock', () => {
    expect([0, 4, 12, 16, 23].map(hourLabel)).toEqual(['12 AM', '4 AM', '12 PM', '4 PM', '11 PM']);
  });

  it('runs from 4 PM to at least nine bars, marking the current hour', () => {
    const bars = tonightHours([at(17, 5).toISOString(), at(20, 1).toISOString(), at(20, 40).toISOString()], at(20, 50));
    expect(bars.map((b) => b.label)).toEqual(['4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM', '12 AM']);
    expect(bars.find((b) => b.label === '8 PM')).toMatchObject({ pours: 2, isNow: true });
    expect(bars.find((b) => b.label === '5 PM')!.pours).toBe(1);
  });

  it('starts earlier for an afternoon pour and keeps 1 am on the same night', () => {
    const bars = tonightHours([at(13).toISOString(), at(0, 30, 23).toISOString()], at(1, 10, 23));
    expect(bars[0]!.label).toBe('1 PM');
    expect(bars[bars.length - 1]).toMatchObject({ label: '1 AM', isNow: true });
    expect(bars.find((b) => b.label === '12 AM')!.pours).toBe(1);
  });

  it('labels a daylight-saving night by the real clock and keeps its 25th hour', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // Fall back, 1 Nov 2026: 2 AM EDT becomes 1 AM EST, so tonight runs 25 hours.
      const pours = ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-01T08:30:00Z'];
      const bars = tonightHours(pours, new Date('2026-11-01T08:45:00Z'));
      expect(bars.filter((b) => b.label === '1 AM').map((b) => b.pours)).toEqual([1, 1]);
      expect(bars[bars.length - 1]).toMatchObject({ label: '3 AM', pours: 1, isNow: true });
      expect(new Set(bars.map((b) => b.offset)).size).toBe(bars.length);
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it('ignores pours from before tonight began', () => {
    const bars = tonightHours([at(3, 59).toISOString()], at(18));
    expect(bars.every((b) => b.pours === 0)).toBe(true);
  });
});

describe('attention wording', () => {
  const base: AttentionInput = {
    taps: [], units: 'us', servingSizeMl: 473, downSources: [], undervolted: null, reboot: null,
    cleaningDueTapIds: [], tonightPours: [], hasPourers: false, hasWall: true, canReboot: true,
  };

  it('spells small counts and joins lists like a sentence', () => {
    expect(countWord(11)).toBe('eleven');
    expect(countWord(14)).toBe('14');
    expect(listJoin(['a'])).toBe('a');
    expect(listJoin(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('folds several down sources into one problem row', () => {
    const items = buildAttention({ ...base, downSources: ['Kegtron cloud', 'Govee gateway'] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ level: 'problem', title: 'Two sources stopped answering' });
    expect(items[0]!.detail).toContain('Kegtron cloud and Govee gateway');
  });

  it('offers no reboot button when the OS isn’t managed by Kegwall, or to a non-admin', () => {
    expect(buildAttention({ ...base, reboot: { required: true, osManaged: false } })[0]!.action).toBeUndefined();
    expect(buildAttention({ ...base, reboot: { required: true, osManaged: true }, canReboot: false })[0]!.action)
      .toBeUndefined();
    expect(buildAttention({ ...base, reboot: { required: true, osManaged: true } })[0]!.action)
      .toEqual({ label: 'Reboot now', reboot: true });
  });

  it('counts what is left in the taproom’s own serving, and leads the headline with the keg count', () => {
    const keg = (id: number, remainingMl: number) => ({
      tapId: id, tapNumber: id, beer: { name: `Beer ${id}` }, nextUpBeerName: null,
      keg: { id, status: 'on_tap', levelPct: 5, remainingMl },
    }) as unknown as AttentionInput['taps'][number];
    const items = buildAttention({ ...base, servingSizeMl: 400, taps: [keg(1, 2000), keg(2, 900), keg(3, 300)] });
    expect(items[0]).toMatchObject({ kind: 'low-kegs', count: 3, title: 'Swap three kegs soon' });
    expect(items[0]!.detail).toContain('Beer 3 on tap 3 (under a pour)');
    expect(items[0]!.detail).toContain('Beer 1 on tap 1 (about five pours)');
    expect(tonightHeadline(3, items)).toBe('Three on tap. Three kegs need a swap soon.');
  });

  it('ranks problem, then caution, then info', () => {
    const items = buildAttention({
      ...base,
      hasWall: false,
      reboot: { required: true, osManaged: true },
      undervolted: { now: false, sinceBoot: true },
    });
    expect(items.map((i) => i.level)).toEqual(['problem', 'caution', 'info']);
    expect(tonightHeadline(3, items)).toBe('Three on tap. This Pi ran short of power since it started.');
  });
});
