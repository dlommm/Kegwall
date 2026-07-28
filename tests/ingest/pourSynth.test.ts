import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, type MonitorRef } from '../../src/server/core/events.js';
import { PourSynthesizer } from '../../src/server/ingest/gen1/pourSynth.js';

// Fast test-only overrides for thresholdMl/stabilizeMs -- same established precedent as
// udpSource.ts's pourTimeoutMs / cloudSource.ts's reconnectBaseMs (see those files' doc
// comments): lets the "5 s stable" debounce be exercised in milliseconds rather than
// waiting out a real 5-second window. Production defaults are 20mL / 5000ms (brief).
const FAST_STABILIZE_MS = 30;
const THRESHOLD_ML = 20;

let bus: EventBus;
let events: { event: string; payload: any }[];
let synth: PourSynthesizer;

function byEvent(name: string): any[] {
  return events.filter((e) => e.event === name).map((e) => e.payload);
}

function ref(portIndex = 0, identifier = 'aa:bb:cc:dd:ee:ff'): MonitorRef {
  return { type: 'kegtron_gen1', identifier, portIndex };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  bus = new EventBus();
  events = [];
  for (const name of ['volume_update', 'pour_completed'] as const) {
    bus.on(name, (payload) => events.push({ event: name, payload }));
  }
  synth = new PourSynthesizer(bus, { thresholdMl: THRESHOLD_ML, stabilizeMs: FAST_STABILIZE_MS });
});

describe('PourSynthesizer.onReading()', () => {
  it('always emits volume_update, even on the very first reading for a ref', () => {
    synth.onReading(ref(), 5000, 1000, 18927, '2026-07-28T10:00:00.000Z');
    expect(byEvent('volume_update')).toEqual([
      { monitor: ref(), volStartMl: 5000, volDispensedMl: 1000, sizeMl: 18927, ts: '2026-07-28T10:00:00.000Z' },
    ]);
    expect(byEvent('pour_completed')).toHaveLength(0);
  });

  it('ignores a cumulative rise that never reaches the 20mL threshold (no timer ever fires)', async () => {
    synth.onReading(ref(), 5000, 1000, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(ref(), 5000, 1015, null, '2026-07-28T10:00:01.000Z'); // +15mL, below threshold
    await wait(FAST_STABILIZE_MS * 3);
    expect(byEvent('pour_completed')).toHaveLength(0);
    // volume_update still fires for every reading regardless of pour inference.
    expect(byEvent('volume_update')).toHaveLength(2);
  });

  it('fires exactly one pour_completed with the correct volume once a >=20mL rise stabilizes for the debounce window', async () => {
    synth.onReading(ref(), 5000, 1000, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(ref(), 5000, 1030, null, '2026-07-28T10:00:01.000Z'); // +30mL, crosses threshold

    expect(byEvent('pour_completed')).toHaveLength(0); // not yet -- debounce still pending
    await wait(FAST_STABILIZE_MS * 3);

    const completed = byEvent('pour_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ monitor: ref(), volumeMl: 30, source: 'ble' });
    expect(completed[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof completed[0].ts).toBe('string');
  });

  it('keeps pushing the debounce window out while volDisp keeps rising, firing only once for the final settled total', async () => {
    synth.onReading(ref(), 0, 0, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(ref(), 0, 25, null, '2026-07-28T10:00:01.000Z'); // crosses threshold, arms timer
    await wait(FAST_STABILIZE_MS / 2);
    synth.onReading(ref(), 0, 40, null, '2026-07-28T10:00:01.500Z'); // still rising -- re-arms timer
    await wait(FAST_STABILIZE_MS / 2);
    expect(byEvent('pour_completed')).toHaveLength(0); // re-armed, so not settled yet

    await wait(FAST_STABILIZE_MS * 3);
    const completed = byEvent('pour_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ volumeMl: 40 });
  });

  it('rebaselines silently on a decrease (device/keg reset), cancelling any pending pour, then measures the next pour from the new baseline', async () => {
    synth.onReading(ref(), 5000, 1000, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(ref(), 5000, 1030, null, '2026-07-28T10:00:01.000Z'); // crosses threshold, timer armed
    synth.onReading(ref(), 0, 0, null, '2026-07-28T10:00:01.500Z'); // reset: dispensed drops to 0

    await wait(FAST_STABILIZE_MS * 3);
    expect(byEvent('pour_completed')).toHaveLength(0); // the pending pour was cancelled, not completed

    // A fresh pour measured from the new (0) baseline still works normally afterward.
    synth.onReading(ref(), 0, 25, null, '2026-07-28T10:00:02.000Z');
    await wait(FAST_STABILIZE_MS * 3);
    const completed = byEvent('pour_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ volumeMl: 25 });
  });

  it('tracks interleaved ports independently -- each ref gets its own baseline/timer/pour', async () => {
    const port0 = ref(0);
    const port1 = ref(1);

    synth.onReading(port0, 5000, 1000, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(port1, 3000, 500, null, '2026-07-28T10:00:00.100Z');
    synth.onReading(port0, 5000, 1030, null, '2026-07-28T10:00:01.000Z'); // port0: +30mL
    await wait(FAST_STABILIZE_MS / 2);
    synth.onReading(port1, 3000, 525, null, '2026-07-28T10:00:01.100Z'); // port1: +25mL

    await wait(FAST_STABILIZE_MS * 4);
    const completed = byEvent('pour_completed');
    expect(completed).toHaveLength(2);
    const byPort = (p: number) => completed.find((c) => c.monitor.portIndex === p);
    expect(byPort(0)).toMatchObject({ monitor: port0, volumeMl: 30 });
    expect(byPort(1)).toMatchObject({ monitor: port1, volumeMl: 25 });
  });

  it('treats a repeated identical reading as a no-op (no re-arm, no duplicate completion)', async () => {
    synth.onReading(ref(), 5000, 1000, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(ref(), 5000, 1030, null, '2026-07-28T10:00:01.000Z');
    synth.onReading(ref(), 5000, 1030, null, '2026-07-28T10:00:01.200Z'); // duplicate, same value

    await wait(FAST_STABILIZE_MS * 3);
    const completed = byEvent('pour_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ volumeMl: 30 });
  });
});

describe('PourSynthesizer.dispose()', () => {
  it('cancels all pending debounce timers so no further pour_completed events fire', async () => {
    synth.onReading(ref(), 0, 0, null, '2026-07-28T10:00:00.000Z');
    synth.onReading(ref(), 0, 30, null, '2026-07-28T10:00:01.000Z');
    synth.dispose();

    await wait(FAST_STABILIZE_MS * 3);
    expect(byEvent('pour_completed')).toHaveLength(0);
  });
});
