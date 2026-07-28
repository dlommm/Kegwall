import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/server/core/events.js';

describe('EventBus', () => {
  it('delivers typed events to subscribers', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('volume_update', fn);
    bus.emit('volume_update', {
      monitor: { type: 'kegtron_gen1', identifier: 'aa:bb:cc:dd:ee:ff', portIndex: 0 },
      volStartMl: 19000,
      volDispensedMl: 1250,
      sizeMl: 19000,
      ts: '2026-07-27T00:00:00.000Z',
    });
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0]![0].volDispensedMl).toBe(1250);
  });

  it('isolates subscriber errors', () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.on('pour_completed', () => { throw new Error('bad subscriber'); });
    bus.on('pour_completed', good);
    bus.emit('pour_completed', {
      monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 1 },
      volumeMl: 400, durationMs: 5000, source: 'cloud',
      ts: '2026-07-27T00:00:00.000Z',
    });
    expect(good).toHaveBeenCalledOnce(); // second subscriber still ran
  });
});
