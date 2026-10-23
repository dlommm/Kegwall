import { describe, it, expect } from 'vitest';
import { wallConfigSchema, parseWallConfig } from '../../src/server/core/wallConfig.js';

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

describe('wallConfigSchema takeover (pour takeover)', () => {
  it("defaults to off with a ~2 oz (60 mL) trigger so stored configs don't change behavior", () => {
    const config = wallConfigSchema.parse({});
    expect(config.takeover).toEqual({ style: 'off', minMl: 60, finish: 'plain' });
  });

  it('accepts each takeover style', () => {
    for (const style of ['off', 'full', 'spotlight', 'split', 'dock', 'fill'] as const) {
      expect(wallConfigSchema.parse({ takeover: { style } }).takeover.style).toBe(style);
    }
  });

  it('rejects unknown styles and negative thresholds', () => {
    expect(() => wallConfigSchema.parse({ takeover: { style: 'confetti' } })).toThrow();
    expect(() => wallConfigSchema.parse({ takeover: { style: 'full', minMl: -1 } })).toThrow();
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

describe('displayPower', () => {
  it('defaults to fully disabled', () => {
    const c = wallConfigSchema.parse({});
    expect(c.displayPower).toEqual({
      screensaverAfterMinutes: null, offAfterMinutes: null, cameraMotion: false,
    });
  });

  it('rejects offAfterMinutes <= screensaverAfterMinutes', () => {
    expect(() => wallConfigSchema.parse({
      displayPower: { screensaverAfterMinutes: 30, offAfterMinutes: 30 },
    })).toThrow();
  });

  it('accepts off-only (screensaver null, offAfterMinutes set)', () => {
    const c = wallConfigSchema.parse({ displayPower: { offAfterMinutes: 120 } });
    expect(c.displayPower.offAfterMinutes).toBe(120);
    expect(c.displayPower.screensaverAfterMinutes).toBeNull();
  });

  it('parseWallConfig maps a legacy enabled screensaver into displayPower', () => {
    const c = parseWallConfig({ screensaver: { enabled: true, startAfterMinutes: 15 } });
    expect(c.displayPower.screensaverAfterMinutes).toBe(15);
  });

  it('parseWallConfig leaves an explicit displayPower alone (legacy key ignored)', () => {
    const c = parseWallConfig({
      screensaver: { enabled: true, startAfterMinutes: 15 },
      displayPower: { screensaverAfterMinutes: 5, offAfterMinutes: null, cameraMotion: false },
    });
    expect(c.displayPower.screensaverAfterMinutes).toBe(5);
  });

  it('parseWallConfig with disabled legacy screensaver stays fully off', () => {
    const c = parseWallConfig({ screensaver: { enabled: false, startAfterMinutes: 10 } });
    expect(c.displayPower.screensaverAfterMinutes).toBeNull();
  });
});

describe('wallConfigSchema theme overrides (CSS-injection hardening)', () => {
  it('accepts real --custom-property tokens with plain values', () => {
    const c = wallConfigSchema.parse({
      theme: { id: 'x', overrides: { '--wall-bg': '#0b1020', '--accent': 'rgb(10 20 30)' } },
    });
    expect(c.theme.overrides).toEqual({ '--wall-bg': '#0b1020', '--accent': 'rgb(10 20 30)' });
  });

  it('rejects a non-custom-property key', () => {
    expect(() => wallConfigSchema.parse({
      theme: { id: 'x', overrides: { color: 'red' } },
    })).toThrow();
  });

  it('rejects a value that tries to break out of the declaration (; { })', () => {
    expect(() => wallConfigSchema.parse({
      theme: { id: 'x', overrides: { '--wall-bg': 'red; } body { display: none } .x {' } },
    })).toThrow();
  });
});

describe('Kegwall V2 additions (additive, stored configs untouched)', () => {
  it('parses a pre-V2 stored config unchanged apart from the new spotlight default', () => {
    const stored = { look: 'ledger', theme: { id: 'cream' }, takeover: { style: 'full', minMl: 90 } };
    const parsed = wallConfigSchema.parse(stored);
    expect(parsed.look).toBe('ledger');
    expect(parsed.takeover).toEqual({ style: 'full', minMl: 90, finish: 'plain' });
    expect(parsed.wallMoments).toEqual({ kicked: false, tapped: false, milestone: false });
    expect(parsed.spotlight).toEqual({ mode: 'newest', tapId: null });
    expect(wallConfigSchema.parse(parsed)).toEqual(parsed); // idempotent round trip
  });

  it.each(['just-tapped', 'handles', 'tally'])('accepts the new look %s', (look) => {
    expect(wallConfigSchema.parse({ look }).look).toBe(look);
  });

  it('keeps a pinned spotlight tap', () => {
    expect(wallConfigSchema.parse({ spotlight: { mode: 'pinned', tapId: 4 } }).spotlight)
      .toEqual({ mode: 'pinned', tapId: 4 });
  });
});
