import { describe, it, expect, vi } from 'vitest';
import { EventBus, monitorRefKey } from '../../src/server/core/events.js';

describe('monitorRefKey', () => {
  it('joins type, identifier and portIndex (the single canonical MonitorRef key -- '
    + 'Final review Minor 7/T5: was duplicated across state.ts/pourDedupe.ts/pourSynth.ts)', () => {
    expect(monitorRefKey({ type: 'kegtron_pro', identifier: 'dev1', portIndex: 2 }))
      .toBe('kegtron_pro:dev1:2');
  });

  it('distinguishes refs that differ only by type, identifier, or portIndex', () => {
    const base = monitorRefKey({ type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 });
    expect(monitorRefKey({ type: 'kegtron_gen1', identifier: 'dev1', portIndex: 0 })).not.toBe(base);
    expect(monitorRefKey({ type: 'kegtron_pro', identifier: 'dev2', portIndex: 0 })).not.toBe(base);
    expect(monitorRefKey({ type: 'kegtron_pro', identifier: 'dev1', portIndex: 1 })).not.toBe(base);
  });
});

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
