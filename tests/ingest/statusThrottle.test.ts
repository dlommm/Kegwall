import { describe, it, expect } from 'vitest';
import { SourceStatusThrottle } from '../../src/server/ingest/statusThrottle.js';

// ---------------------------------------------------------------------------
// SourceStatusThrottle (server-hardening review, 2026-08-29): gates the ROUTINE
// per-datagram/per-reading `source_status` repeats in kegtron_udp / gen1_mqtt. Pure
// clock-in, decision-out — every case passes an explicit nowMs, no fake timers needed.
// Source-level wiring is covered by tests/ingest/udpStatusThrottle.test.ts.
// ---------------------------------------------------------------------------

const INTERVAL = 30_000;
const T0 = 1_000_000;

describe('SourceStatusThrottle', () => {
  it('always passes the very first routine emission (fast "data is flowing" feedback)', () => {
    const throttle = new SourceStatusThrottle(INTERVAL);
    expect(throttle.shouldEmit(true, T0)).toBe(true);
  });

  it('passes the first routine emission even right after an unthrottled emit of the same state', () => {
    const throttle = new SourceStatusThrottle(INTERVAL);
    throttle.note(true, T0); // e.g. the bind-time "listening on ..." emit
    expect(throttle.shouldEmit(true, T0 + 1)).toBe(true);
  });

  it('suppresses unchanged repeats inside the interval, then passes one after it elapses', () => {
    const throttle = new SourceStatusThrottle(INTERVAL);
    expect(throttle.shouldEmit(true, T0)).toBe(true);
    expect(throttle.shouldEmit(true, T0 + 200)).toBe(false); // 5/sec pour packets...
    expect(throttle.shouldEmit(true, T0 + 400)).toBe(false);
    expect(throttle.shouldEmit(true, T0 + INTERVAL - 1)).toBe(false);
    expect(throttle.shouldEmit(true, T0 + INTERVAL)).toBe(true);
    expect(throttle.shouldEmit(true, T0 + INTERVAL + 200)).toBe(false);
  });

  it('passes a healthy-flag transition immediately, whichever path emitted last', () => {
    const throttle = new SourceStatusThrottle(INTERVAL);
    expect(throttle.shouldEmit(true, T0)).toBe(true);
    // An error emit went out unthrottled and note()d itself...
    throttle.note(false, T0 + 1_000);
    // ...so the next healthy reading is a RECOVERY and must not wait out the interval.
    expect(throttle.shouldEmit(true, T0 + 1_500)).toBe(true);
    expect(throttle.shouldEmit(true, T0 + 1_700)).toBe(false);
  });

  it('a zero interval disables throttling of repeats entirely', () => {
    const throttle = new SourceStatusThrottle(0);
    expect(throttle.shouldEmit(true, T0)).toBe(true);
    expect(throttle.shouldEmit(true, T0)).toBe(true);
    expect(throttle.shouldEmit(true, T0 + 1)).toBe(true);
  });
});
