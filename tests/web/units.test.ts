import { describe, it, expect } from 'vitest';
import { formatVolumeMl, formatTempC } from '../../src/web/lib/units';

describe('formatVolumeMl', () => {
  it('formats US units as fluid ounces to one decimal place', () => {
    expect(formatVolumeMl(473, 'us')).toBe('16.0 oz');
  });

  it('formats metric units as whole milliliters', () => {
    expect(formatVolumeMl(473, 'metric')).toBe('473 mL');
  });

  it('rounds metric mL to the nearest whole number', () => {
    expect(formatVolumeMl(354.6, 'metric')).toBe('355 mL');
  });

  it('handles zero', () => {
    expect(formatVolumeMl(0, 'us')).toBe('0.0 oz');
    expect(formatVolumeMl(0, 'metric')).toBe('0 mL');
  });

  it('clamps negative or non-finite input to zero instead of producing nonsense', () => {
    expect(formatVolumeMl(-40, 'us')).toBe('0.0 oz');
    expect(formatVolumeMl(Number.NaN, 'metric')).toBe('0 mL');
  });
});

describe('formatTempC', () => {
  it('converts to Fahrenheit for us units, rounded to the nearest degree', () => {
    expect(formatTempC(4, 'us')).toBe('39°F');
    expect(formatTempC(0, 'us')).toBe('32°F');
  });

  it('renders Celsius directly (rounded) for metric units', () => {
    expect(formatTempC(4, 'metric')).toBe('4°C');
    expect(formatTempC(3.6, 'metric')).toBe('4°C');
  });
});
