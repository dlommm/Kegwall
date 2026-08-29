import { describe, it, expect, vi } from 'vitest';
import {
  broadcastTo, MAX_BUFFERED_AMOUNT_BYTES, type BroadcastClient,
} from '../../src/server/routes/ws.js';

// ---------------------------------------------------------------------------
// Backpressure guard (server-hardening review, 2026-08-29): a client that stops
// reading must not make the server buffer broadcasts unboundedly. `broadcastTo` is
// deliberately structural (BroadcastClient) so this can exercise the guard with plain
// fakes — forcing a real `ws` socket's bufferedAmount past 1MB deterministically in a
// test would mean fighting OS TCP buffers. The full-socket happy path stays covered by
// tests/routes/ws.test.ts.
// ---------------------------------------------------------------------------

const OPEN = 1;
const CLOSING = 2;

function fakeSocket(overrides: Partial<BroadcastClient> = {}): BroadcastClient & { send: ReturnType<typeof vi.fn> } {
  return {
    readyState: OPEN, OPEN, bufferedAmount: 0, send: vi.fn(), ...overrides,
  } as BroadcastClient & { send: ReturnType<typeof vi.fn> };
}

describe('broadcastTo', () => {
  it('sends to every open, drained client', () => {
    const a = fakeSocket();
    const b = fakeSocket();
    broadcastTo([a, b], 'msg');
    expect(a.send).toHaveBeenCalledWith('msg');
    expect(b.send).toHaveBeenCalledWith('msg');
  });

  it('skips sockets that are not OPEN', () => {
    const closing = fakeSocket({ readyState: CLOSING });
    broadcastTo([closing], 'msg');
    expect(closing.send).not.toHaveBeenCalled();
  });

  it('skips a stalled socket whose bufferedAmount exceeds the threshold, without derailing the rest', () => {
    const stalled = fakeSocket({ bufferedAmount: MAX_BUFFERED_AMOUNT_BYTES + 1 });
    const healthy = fakeSocket();
    broadcastTo([stalled, healthy], 'msg');
    expect(stalled.send).not.toHaveBeenCalled();
    expect(healthy.send).toHaveBeenCalledWith('msg');
  });

  it('still sends at exactly the threshold (guard is strictly greater-than)', () => {
    const atLimit = fakeSocket({ bufferedAmount: MAX_BUFFERED_AMOUNT_BYTES });
    broadcastTo([atLimit], 'msg');
    expect(atLimit.send).toHaveBeenCalledWith('msg');
  });

  it('resumes sending once a previously-stalled socket drains', () => {
    const socket = fakeSocket({ bufferedAmount: MAX_BUFFERED_AMOUNT_BYTES + 1 });
    broadcastTo([socket], 'first');
    expect(socket.send).not.toHaveBeenCalled();
    socket.bufferedAmount = 0; // client caught up — next snapshot resyncs it
    broadcastTo([socket], 'second');
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith('second');
  });
});
