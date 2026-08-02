import { describe, it, expect } from 'vitest';
import { buildSensorCards } from '../../src/web/lib/sensorCards';
import type { SensorSummary } from '../../src/web/lib/adminApi';

function sensor(over: Partial<SensorSummary> & Pick<SensorSummary, 'id' | 'kind'>): SensorSummary {
  return {
    name: 'S', tempC: 3, humidity: null, lastSeen: null, min7dC: 1, max7dC: 5, ...over,
  };
}

describe('buildSensorCards', () => {
  it('measures each Govee delta against the coldest Kegtron probe', () => {
    const cards = buildSensorCards([
      sensor({ id: 1, kind: 'kegtron', tempC: 3 }),
      sensor({ id: 2, kind: 'kegtron', tempC: 4 }),
      sensor({ id: 3, kind: 'govee', tempC: 5.4 }),
    ]);
    // Reference = min(3, 4) = 3. Govee at 5.4 → +2.4.
    const govee = cards.find((c) => c.id === 3)!;
    expect(govee.deltaVsRefC).toBe(2.4);
    expect(govee.warming).toBe(true);
  });

  it('leaves Kegtron probes without a delta and never flags them warming', () => {
    const cards = buildSensorCards([
      sensor({ id: 1, kind: 'kegtron', tempC: 3 }),
      sensor({ id: 2, kind: 'govee', tempC: 3.5 }),
    ]);
    expect(cards.find((c) => c.id === 1)!.deltaVsRefC).toBeNull();
    expect(cards.find((c) => c.id === 1)!.warming).toBe(false);
    // Govee only 0.5 warmer → not warming.
    expect(cards.find((c) => c.id === 2)!.warming).toBe(false);
  });

  it('yields null deltas when there is no Kegtron reference', () => {
    const cards = buildSensorCards([sensor({ id: 1, kind: 'govee', tempC: 9 })]);
    expect(cards[0]!.deltaVsRefC).toBeNull();
    expect(cards[0]!.warming).toBe(false);
  });
});
