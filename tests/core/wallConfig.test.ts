import { describe, it, expect } from 'vitest';
import { wallConfigSchema } from '../../src/server/core/wallConfig.js';

describe('wallConfigSchema screensaver', () => {
  it('defaults to disabled with a 10-minute start delay', () => {
    const config = wallConfigSchema.parse({});
    expect(config.screensaver).toEqual({ enabled: false, startAfterMinutes: 10 });
  });

  it('accepts an explicit screensaver override', () => {
    const config = wallConfigSchema.parse({
      screensaver: { enabled: true, startAfterMinutes: 5 },
    });
    expect(config.screensaver).toEqual({ enabled: true, startAfterMinutes: 5 });
  });

  it('rejects a non-positive startAfterMinutes', () => {
    expect(() => wallConfigSchema.parse({
      screensaver: { enabled: true, startAfterMinutes: 0 },
    })).toThrow();
  });
});

describe('wallConfigSchema look/glyphMode (Pour Wall overhaul)', () => {
  it("defaults to the 'classic' look with 'flat' glyphs so stored configs render unchanged", () => {
    const config = wallConfigSchema.parse({});
    expect(config.look).toBe('classic');
    expect(config.glyphMode).toBe('flat');
  });

  it('accepts each overhaul look and glyph mode', () => {
    for (const look of ['classic', 'ledger', 'gallery', 'columns'] as const) {
      expect(wallConfigSchema.parse({ look }).look).toBe(look);
    }
    for (const glyphMode of ['flat', 'outline', 'duotone'] as const) {
      expect(wallConfigSchema.parse({ glyphMode }).glyphMode).toBe(glyphMode);
    }
  });

  it('rejects unknown look/glyphMode values', () => {
    expect(() => wallConfigSchema.parse({ look: 'brutalist' })).toThrow();
    expect(() => wallConfigSchema.parse({ glyphMode: 'neon' })).toThrow();
  });

  it('defaults the theme to midnight-slate and keeps the header subtitle optional', () => {
    const config = wallConfigSchema.parse({});
    expect(config.theme.id).toBe('midnight-slate');
    expect(config.header.subtitle).toBeUndefined();
    const withSubtitle = wallConfigSchema.parse({
      header: { subtitle: 'Trivia Thursdays', showClock: false, showTemp: false },
    });
    expect(withSubtitle.header.subtitle).toBe('Trivia Thursdays');
  });
});

describe('wallConfigSchema fillStyle (keg-asset fill indicator feature)', () => {
  it("defaults to 'liquid' (the existing SRM LiquidFill) when omitted", () => {
    const config = wallConfigSchema.parse({});
    expect(config.fillStyle).toBe('liquid');
  });

  it("accepts an explicit 'keg' override", () => {
    const config = wallConfigSchema.parse({ fillStyle: 'keg' });
    expect(config.fillStyle).toBe('keg');
  });

  it('rejects an unrecognized fillStyle value', () => {
    expect(() => wallConfigSchema.parse({ fillStyle: 'bogus' })).toThrow();
  });
});
