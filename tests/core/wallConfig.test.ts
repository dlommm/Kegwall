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
