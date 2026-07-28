import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { WebSocketServer, WebSocket as WsClient, type WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { useTapStates } from '../../src/web/lib/useTapStates';
import type { TapState } from '../../src/server/core/state';

function makeTap(overrides: Partial<TapState> = {}): TapState {
  return {
    tapId: 1,
    tapNumber: 1,
    tapName: null,
    beer: null,
    keg: null,
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true,
    ...overrides,
  };
}

// --- Real `ws` package server: end-to-end socket lifecycle (connect, snapshot, reconnect) ---
describe('useTapStates (real ws server)', () => {
  let wss: WebSocketServer | undefined;

  beforeEach(() => {
    // jsdom's own `WebSocket` (vendored from undici) has a known cross-realm Event bug
    // that throws as soon as a real connection opens ("event argument must be an instance
    // of Event. Received an instance of Event") — so for real-socket tests we point the
    // global at the `ws` package's own WebSocket client instead. It's still a genuine
    // socket speaking the real protocol to a genuine `ws` server, just not jsdom's client.
    vi.stubGlobal('WebSocket', WsClient);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (wss) {
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
      wss = undefined;
    }
  });

  function startServer(onConnection: (socket: WsSocket) => void): Promise<string> {
    return new Promise((resolve) => {
      wss = new WebSocketServer({ port: 0 });
      wss.on('connection', onConnection);
      wss.on('listening', () => {
        const { port } = wss!.address() as AddressInfo;
        resolve(`ws://127.0.0.1:${port}`);
      });
    });
  }

  it('applies snapshot messages received over the socket and reports connected', async () => {
    const taps = [makeTap({ tapId: 2, tapName: 'Left' })];
    const url = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'snapshot', taps }));
    });

    const { result, unmount } = renderHook(() => useTapStates([], { url }));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.taps).toEqual(taps));
    expect(result.current.stale).toBe(false);

    unmount();
  });

  it('reconnects after the server drops the connection and applies the fresh snapshot', async () => {
    let connectionCount = 0;
    const secondTaps = [makeTap({ tapId: 9, tapName: 'Reconnected' })];
    const url = await startServer((socket) => {
      connectionCount += 1;
      if (connectionCount === 1) {
        socket.send(JSON.stringify({ type: 'snapshot', taps: [] }));
        socket.close();
      } else {
        socket.send(JSON.stringify({ type: 'snapshot', taps: secondTaps }));
      }
    });

    const { result, unmount } = renderHook(() => useTapStates([], { url }));

    // The first connection opens, receives a snapshot, and is closed by the server almost
    // immediately — asserting on the transient `connected: true` in between is racy (it can
    // flip back to false between polls), so just wait for the eventual reconnect to land.
    await waitFor(() => expect(connectionCount).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await waitFor(() => expect(result.current.taps).toEqual(secondTaps), { timeout: 3000 });
    await waitFor(() => expect(result.current.connected).toBe(true), { timeout: 3000 });
    expect(result.current.reconnectCount).toBeGreaterThanOrEqual(1);

    unmount();
  }, 10000);
});

// --- Fake in-memory WebSocket: deterministic staleness/backoff/cleanup under fake timers ---
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('useTapStates (fake WebSocket + fake timers)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('flags stale after 60s without any message, and clears staleness on the next message', () => {
    const { result } = renderHook(() => useTapStates([]));
    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.triggerOpen());

    expect(result.current.stale).toBe(false);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.stale).toBe(true);

    act(() => socket.triggerMessage({ type: 'snapshot', taps: [] }));
    expect(result.current.stale).toBe(false);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current.stale).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.stale).toBe(true);
  });

  it('treats a server heartbeat ping as liveness too, resetting staleness without touching taps', () => {
    // Phase 3 final review, finding I1: the server now sends {type:'ping', ts} every 30s
    // so an idle wall (no snapshot for minutes) doesn't falsely show "Reconnecting…". The
    // hook must reset its 60s stale timer on ANY message, not just snapshot messages.
    const { result } = renderHook(() => useTapStates([]));
    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.triggerOpen());

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current.stale).toBe(false);

    act(() => socket.triggerMessage({ type: 'ping', ts: new Date().toISOString() }));
    expect(result.current.stale).toBe(false);
    // A ping is not a snapshot — it must not clobber the (empty) taps array.
    expect(result.current.taps).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current.stale).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.stale).toBe(true);
  });

  it('reconnects with exponential backoff (1s doubling, capped at 30s)', () => {
    renderHook(() => useTapStates([]));
    expect(FakeWebSocket.instances).toHaveLength(1);

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (let i = 0; i < expectedDelays.length; i += 1) {
      const delay = expectedDelays[i]!;
      const current = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
      act(() => current.triggerClose());

      act(() => {
        vi.advanceTimersByTime(delay - 1);
      });
      expect(FakeWebSocket.instances).toHaveLength(i + 1);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(FakeWebSocket.instances).toHaveLength(i + 2);
    }
  });

  it('applies a snapshot from the fake socket', () => {
    const { result } = renderHook(() => useTapStates([]));
    const socket = FakeWebSocket.instances[0]!;
    const taps = [makeTap({ tapId: 5 })];

    act(() => socket.triggerOpen());
    act(() => socket.triggerMessage({ type: 'snapshot', taps }));

    expect(result.current.taps).toEqual(taps);
  });

  it('falls back to a later `initial` value until the first live message arrives', () => {
    const laterInitial = [makeTap({ tapId: 3 })];
    const { result, rerender } = renderHook(
      ({ initial }) => useTapStates(initial),
      { initialProps: { initial: [] as TapState[] } },
    );
    expect(result.current.taps).toEqual([]);

    // Simulates useWallData's REST fetch resolving after mount but before the socket's
    // first snapshot — the hook should reflect that fresher `initial`, not freeze at [].
    rerender({ initial: laterInitial });
    expect(result.current.taps).toEqual(laterInitial);

    const liveTaps = [makeTap({ tapId: 7 })];
    const socket = FakeWebSocket.instances[0]!;
    act(() => socket.triggerMessage({ type: 'snapshot', taps: liveTaps }));
    expect(result.current.taps).toEqual(liveTaps);

    // Once a live message has been received, further `initial` changes must never
    // override it — the socket is now the source of truth.
    rerender({ initial: [makeTap({ tapId: 99 })] });
    expect(result.current.taps).toEqual(liveTaps);
  });

  it('ignores non-snapshot messages', () => {
    const { result } = renderHook(() => useTapStates([]));
    const socket = FakeWebSocket.instances[0]!;

    act(() => socket.triggerOpen());
    act(() => socket.triggerMessage({ type: 'other', foo: 'bar' }));

    expect(result.current.taps).toEqual([]);
  });

  it('increments reconnectCount only after a prior successful open', () => {
    const { result } = renderHook(() => useTapStates([]));
    act(() => FakeWebSocket.instances[0]!.triggerOpen());
    expect(result.current.reconnectCount).toBe(0);

    act(() => FakeWebSocket.instances[0]!.triggerClose());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.reconnectCount).toBe(0);

    act(() => FakeWebSocket.instances[1]!.triggerOpen());
    expect(result.current.reconnectCount).toBe(1);
    expect(result.current.connected).toBe(true);
  });

  it('resets backoff to 1s after a successful reconnect', () => {
    renderHook(() => useTapStates([]));
    act(() => FakeWebSocket.instances[0]!.triggerClose());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    act(() => FakeWebSocket.instances[1]!.triggerOpen());
    act(() => FakeWebSocket.instances[1]!.triggerClose());

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('clears the reconnect timer and closes the socket on unmount without reconnecting again', () => {
    const { unmount } = renderHook(() => useTapStates([]));
    const first = FakeWebSocket.instances[0]!;
    const closeSpy = vi.spyOn(first, 'close');
    act(() => first.triggerClose());

    unmount();

    expect(closeSpy).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
