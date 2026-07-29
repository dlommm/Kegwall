import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { WebSocketServer, WebSocket as WsClient, type WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { useAdminNotifications } from '../../src/web/lib/useAdminNotifications';

// ---------------------------------------------------------------------------
// Phase 5 Task 6: the notification bell's live badge. AdminLayout is the ONE component
// mounted for the whole `/admin/*` session (every page renders under its Outlet) -- unlike
// `useTapStates`, which is opened per-page (only TapsPage/DashboardPage/MonitorsPage
// actually call it), so a rule created on, say, the Beers page would never nudge the badge
// if this piggybacked on a page-scoped connection. This is therefore a DELIBERATE second
// `/ws` socket, dedicated to exactly one message shape (`{type:'notifications',
// unackedCount}` -- see routes/ws.ts's `state_changed{scope:'notifications'}` relay),
// opened once by AdminLayout and never by individual pages.
// ---------------------------------------------------------------------------

describe('useAdminNotifications (real ws server)', () => {
  let wss: WebSocketServer | undefined;

  beforeEach(() => {
    // Same jsdom-WebSocket-bug workaround as useTapStates.test.tsx — see that file's
    // comment for the full story.
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

  it('calls onCount when a {type:"notifications"} message arrives, and reports connected', async () => {
    const url = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'notifications', unackedCount: 3 }));
    });
    const onCount = vi.fn();

    const { result, unmount } = renderHook(() => useAdminNotifications(onCount, { url }));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(3));

    unmount();
  });

  it('ignores messages of other types', async () => {
    const url = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'ping', ts: '2026-07-28T00:00:00.000Z' }));
      socket.send(JSON.stringify({ type: 'snapshot', taps: [] }));
    });
    const onCount = vi.fn();

    const { result, unmount } = renderHook(() => useAdminNotifications(onCount, { url }));
    await waitFor(() => expect(result.current.connected).toBe(true));

    expect(onCount).not.toHaveBeenCalled();
    unmount();
  });

  it('a new onCount identity across renders never tears down/reopens the socket', async () => {
    let connectionCount = 0;
    const url = await startServer(() => {
      connectionCount += 1;
    });

    const { result, rerender, unmount } = renderHook(
      ({ cb }: { cb: (n: number) => void }) => useAdminNotifications(cb, { url }),
      { initialProps: { cb: () => {} } },
    );
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(connectionCount).toBe(1);

    rerender({ cb: () => {} });
    await act(async () => { await Promise.resolve(); });
    expect(connectionCount).toBe(1);

    unmount();
  });

  it('reconnects after the server drops the connection', async () => {
    let connectionCount = 0;
    const url = await startServer((socket) => {
      connectionCount += 1;
      if (connectionCount === 1) socket.close();
      else socket.send(JSON.stringify({ type: 'notifications', unackedCount: 7 }));
    });
    const onCount = vi.fn();

    const { result, unmount } = renderHook(() => useAdminNotifications(onCount, { url }));
    await waitFor(() => expect(connectionCount).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(7), { timeout: 3000 });
    await waitFor(() => expect(result.current.connected).toBe(true), { timeout: 3000 });

    unmount();
  }, 10000);
});
