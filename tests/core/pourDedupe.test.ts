import { describe, it, expect } from 'vitest';
import { PourDeduper } from '../../src/server/core/pourDedupe.js';

const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
const otherPort = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 1 };
const otherDevice = { type: 'kegtron_pro' as const, identifier: 'dev2', portIndex: 0 };

describe('PourDeduper', () => {
  it('suppresses the same pour reported twice (cloud then udp) within the window', () => {
    const dd = new PourDeduper();
    expect(dd.shouldRecord(ref, 400, '2026-07-27T01:00:00.000Z')).toBe(true);
    // 10s later, volume within tolerance (max(10% of 400, 30) = 40mL; diff = 5) -> dup
    expect(dd.shouldRecord(ref, 405, '2026-07-27T01:00:10.000Z')).toBe(false);
  });

  it('records both when the volume differs beyond tolerance', () => {
    const dd = new PourDeduper();
    expect(dd.shouldRecord(ref, 400, '2026-07-27T01:00:00.000Z')).toBe(true);
    // 5s later, diff = 100mL > max(40, 30) tolerance -> not a duplicate
    expect(dd.shouldRecord(ref, 500, '2026-07-27T01:00:05.000Z')).toBe(true);
  });

  it('records both when the same volume repeats 40s apart (outside the 30s window)', () => {
    const dd = new PourDeduper();
    expect(dd.shouldRecord(ref, 400, '2026-07-27T01:00:00.000Z')).toBe(true);
    expect(dd.shouldRecord(ref, 400, '2026-07-27T01:00:40.000Z')).toBe(true);
  });

  it('tracks (type, identifier, portIndex) independently — different port or device is never a duplicate', () => {
    const dd = new PourDeduper();
    expect(dd.shouldRecord(ref, 400, '2026-07-27T01:00:00.000Z')).toBe(true);
    expect(dd.shouldRecord(otherPort, 400, '2026-07-27T01:00:01.000Z')).toBe(true);
    expect(dd.shouldRecord(otherDevice, 400, '2026-07-27T01:00:01.000Z')).toBe(true);
  });

  it('exact-boundary tolerance (30mL floor) and window (30s) are inclusive', () => {
    const dd = new PourDeduper();
    expect(dd.shouldRecord(ref, 100, '2026-07-27T01:00:00.000Z')).toBe(true);
    // diff exactly 30mL (floor tolerance, since 10% of 100 = 10 < 30), at exactly 30s
    expect(dd.shouldRecord(ref, 130, '2026-07-27T01:00:30.000Z')).toBe(false);
  });

  it('does not accumulate unbounded memory across many pours on the same monitor', () => {
    const dd = new PourDeduper();
    const base = Date.parse('2026-07-27T01:00:00.000Z');
    for (let i = 0; i < 10_000; i++) {
      // 61s apart -> always past the 60s expiry, so every call is a fresh (non-duplicate)
      // registration; a naive "keep every entry forever" implementation would grow to
      // 10,000 tracked entries.
      const ts = new Date(base + i * 61_000).toISOString();
      expect(dd.shouldRecord(ref, 400, ts)).toBe(true);
    }
    expect(dd.size()).toBeLessThan(10);
  });

  it('does not accumulate unbounded memory across many duplicate pours in a tight burst', () => {
    const dd = new PourDeduper();
    const base = Date.parse('2026-07-27T01:00:00.000Z');
    expect(dd.shouldRecord(ref, 400, new Date(base).toISOString())).toBe(true);
    for (let i = 1; i < 10_000; i++) {
      // 1ms apart (whole burst stays well within the 30s window), same volume ->
      // every one of these is a duplicate of the first and must not be (re-)registered.
      const ts = new Date(base + i).toISOString();
      expect(dd.shouldRecord(ref, 400, ts)).toBe(false);
    }
    expect(dd.size()).toBeLessThan(10);
  });
});
