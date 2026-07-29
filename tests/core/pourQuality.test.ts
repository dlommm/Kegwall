import { describe, it, expect } from 'vitest';
import { computePourQuality, PourSampleTracker, type PourSample } from '../../src/server/core/pourQuality.js';

const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
const ref2 = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 1 };

/** Samples every 200ms at a constant `mlPerSample` increment. */
function steadySamples(count: number, mlPerSample: number): PourSample[] {
  return Array.from({ length: count }, (_, i) => ({ ts: i * 200, ml: i * mlPerSample }));
}

describe('computePourQuality', () => {
  it('scores a perfectly steady pour 100', () => {
    expect(computePourQuality(steadySamples(10, 12))).toBe(100);
  });

  it('scores an erratic pour low', () => {
    // Alternating gushes and dribbles: rates 30, 1, 30, 1, ... — cv near 1.
    const samples: PourSample[] = [{ ts: 0, ml: 0 }];
    let ml = 0;
    for (let i = 1; i <= 10; i += 1) {
      ml += i % 2 === 0 ? 1 : 60;
      samples.push({ ts: i * 200, ml });
    }
    const score = computePourQuality(samples)!;
    expect(score).toBeLessThan(30);
  });

  it('a mildly wobbly pour lands between', () => {
    const samples: PourSample[] = [{ ts: 0, ml: 0 }];
    let ml = 0;
    for (let i = 1; i <= 10; i += 1) {
      ml += i % 2 === 0 ? 10 : 14;
      samples.push({ ts: i * 200, ml });
    }
    const score = computePourQuality(samples)!;
    expect(score).toBeGreaterThan(60);
    expect(score).toBeLessThan(100);
  });

  it('returns null with too few samples to judge', () => {
    expect(computePourQuality([])).toBeNull();
    expect(computePourQuality(steadySamples(2, 12))).toBeNull();
    expect(computePourQuality(steadySamples(3, 12))).toBeNull(); // only 2 rates
  });

  it('ignores degenerate intervals (repeated ts, counter going backwards)', () => {
    const samples: PourSample[] = [
      { ts: 0, ml: 0 },
      { ts: 200, ml: 12 },
      { ts: 200, ml: 12 }, // duplicate packet
      { ts: 400, ml: 24 },
      { ts: 600, ml: 20 }, // counter hiccup backwards
      { ts: 800, ml: 36 },
      { ts: 1000, ml: 48 },
    ];
    // Still scores from the clean intervals rather than returning garbage.
    const score = computePourQuality(samples);
    expect(score).not.toBeNull();
  });

  it('never leaves the 0-100 range', () => {
    const wild: PourSample[] = [
      { ts: 0, ml: 0 }, { ts: 100, ml: 500 }, { ts: 200, ml: 501 },
      { ts: 300, ml: 999 }, { ts: 400, ml: 1000 },
    ];
    const score = computePourQuality(wild)!;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('PourSampleTracker', () => {
  it('collects begin + progress samples and clears on take', () => {
    const tracker = new PourSampleTracker();
    tracker.begin(ref, 0);
    tracker.progress(ref, 200, 12);
    tracker.progress(ref, 400, 24);
    expect(tracker.take(ref)).toEqual([
      { ts: 0, ml: 0 }, { ts: 200, ml: 12 }, { ts: 400, ml: 24 },
    ]);
    expect(tracker.take(ref)).toEqual([]);
  });

  it('keeps simultaneous pours on different ports separate', () => {
    const tracker = new PourSampleTracker();
    tracker.begin(ref, 0);
    tracker.begin(ref2, 0);
    tracker.progress(ref, 200, 12);
    tracker.progress(ref2, 200, 40);
    expect(tracker.take(ref).map((s) => s.ml)).toEqual([0, 12]);
    expect(tracker.take(ref2).map((s) => s.ml)).toEqual([0, 40]);
  });

  it('starts a run from progress alone when the start was never seen', () => {
    const tracker = new PourSampleTracker();
    tracker.progress(ref, 200, 12);
    tracker.progress(ref, 400, 24);
    expect(tracker.take(ref)).toHaveLength(2);
  });
});
