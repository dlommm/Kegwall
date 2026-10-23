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

  it('ignores pours from before tonight began', () => {
    const bars = tonightHours([at(3, 59).toISOString()], at(18));
    expect(bars.every((b) => b.pours === 0)).toBe(true);
  });
});

describe('attention wording', () => {
  const base: AttentionInput = {
    taps: [], units: 'us', servingSizeMl: 473, downSources: [], undervolted: null, reboot: null,
    cleaningDueTapIds: [], tonightPours: [], hasPourers: false, hasWall: true,
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

  it('offers no reboot button when the OS isn’t managed by Kegwall', () => {
    const items = buildAttention({ ...base, reboot: { required: true, osManaged: false } });
    expect(items[0]!.action).toBeUndefined();
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
