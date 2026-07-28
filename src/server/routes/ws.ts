import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

const DEFAULT_PING_INTERVAL_MS = 30_000;

export interface WsRoutesOptions {
  /**
   * How often to broadcast a `{type:'ping'}` heartbeat to every open client. Defaults to
   * 30s in production; tests override it to a small value instead of faking timers, since
   * this exercises a real `ws`/`@fastify/websocket` socket round-trip.
   */
  pingIntervalMs?: number;
}

export async function wsRoutes(app: FastifyInstance, opts: WsRoutesOptions = {}) {
  await app.register(websocket);

  const clients = new Set<import('ws').WebSocket>();

  const snapshot = () =>
    JSON.stringify({ type: 'snapshot', taps: app.ctx.state.getTapStates() });

  app.ctx.bus.on('state_changed', (e) => {
    if (e.scope !== 'taps') return;
    const msg = snapshot();
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(msg);
    }
  });

  // Heartbeat (Phase 3 final review, finding I1): ingest sources only trigger
  // `state_changed` on an actual change, and a Pro-only/idle taproom can go well past the
  // client's 60s staleness window without one — that's a perfectly healthy socket showing
  // the "Reconnecting…" pill and dimming for most of a quiet wall's life. A 30s ping,
  // comfortably under that 60s window, gives the client contact to reset its timer even
  // when nothing has changed. Started once at route registration (not per-connection) and
  // torn down via `onClose` so it can never outlive the app (e.g. across the many tests
  // that build a fresh app per case).
  const pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const pingInterval = setInterval(() => {
    const msg = JSON.stringify({ type: 'ping', ts: new Date().toISOString() });
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(msg);
    }
  }, pingIntervalMs);
  app.addHook('onClose', () => {
    clearInterval(pingInterval);
  });

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(snapshot());
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
}
