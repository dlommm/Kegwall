import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { unackedCount } from '../db/notificationsRepo.js';
import { toPublicTapState } from '../core/state.js';
import { requireDisplayToken } from './displayAuth.js';

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

  // `version` rides every snapshot so long-lived kiosk clients can detect an app
  // update (server restarted on a new release) and reload themselves — otherwise a
  // wall TV keeps running the pre-update JS bundle forever. See useTapStates.ts.
  // This feed is broadcast to every connected client (wall TVs + the admin taps page).
  // `costCents` (operator cost) is stripped via toPublicTapState — no client reads it, and
  // it must not ride an unauthenticated frame. Hidden taps stay (the admin taps page needs
  // them; the wall client filters them, and sub-epic 3 gates this feed behind a display token).
  const snapshot = () =>
    JSON.stringify({
      type: 'snapshot',
      taps: app.ctx.state.getTapStates().map(toPublicTapState),
      version: app.ctx.version,
    });

  /** Sends `msg` to every currently-connected client (skipping any not `OPEN` -- a socket
   * mid-close/error shouldn't throw the broadcast off for the rest). Shared by every
   * broadcast below (snapshot, ping, banner, theme_override, notifications) so "loop over
   * `clients`" has exactly one implementation. */
  const broadcast = (msg: string): void => {
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(msg);
    }
  };

  app.ctx.bus.on('state_changed', (e) => {
    if (e.scope === 'taps') {
      broadcast(snapshot());
    } else if (e.scope === 'notifications') {
      // Phase 5 Task 4: admin bell-badge nudge (Task 6's notification center) -- the
      // wall/menu clients simply ignore an unrecognized `type` (see useTapStates.ts),
      // so broadcasting this to every socket (not just admin-page ones -- there's no
      // per-connection routing here) is harmless for non-admin listeners.
      broadcast(JSON.stringify({ type: 'notifications', unackedCount: unackedCount(app.ctx.db) }));
    } else if (e.scope === 'walls') {
      // Wall config/device-assignment edits: tells open wall clients to refetch their
      // wall payload (config + allowedTapIds + units) — useWallData.ts handles it.
      broadcast(JSON.stringify({ type: 'walls_changed' }));
    } else if (e.scope === 'faces') {
      // Face sign-in (Plan B): an enrollment or delete changed the face directory —
      // tells the tablet's matcher to refetch GET /api/public/faces.
      broadcast(JSON.stringify({ type: 'faces_changed' }));
    }
  });

  // Host-health relay (Pi monitoring epic): the 60s sampler's reading, for walls with
  // showHostStats. Broadcast to every client like everything else on this feed — the
  // wall is public by design and only renders it when its config asks.
  app.ctx.bus.on('host_stats_sampled', (e) => {
    broadcast(JSON.stringify({ type: 'host_stats', ...e }));
    // scope 'sources' is intentionally not relayed over this feed (unchanged from before
    // wall_banner/wall_theme_override/notifications existed).
  });

  // Phase 5 Task 4: the automation engine's `wall_banner`/`party_mode` actions emit these
  // bus events (automation/engine.ts); this is the relay hand-off to wall clients. Both
  // broadcast to EVERY connected client unconditionally (no per-wall scoping exists on
  // this feed today -- same as the snapshot/ping broadcasts above).
  app.ctx.bus.on('wall_banner', (e) => {
    const msg: { type: 'banner'; text: string; kind: string; durationMs?: number } = {
      type: 'banner', text: e.text, kind: e.kind,
    };
    if (e.durationMs !== undefined) msg.durationMs = e.durationMs;
    broadcast(JSON.stringify(msg));
  });

  app.ctx.bus.on('wall_theme_override', (e) => {
    broadcast(JSON.stringify({ type: 'theme_override', minutes: e.minutes }));
  });

  // Pour Wall overhaul Phase 3: relay tablet-armed pour attributions so the kiosk can
  // flip to its done screen the moment the pour records. Broadcast to every client like
  // everything else on this feed; non-tablet listeners ignore the unknown type.
  app.ctx.bus.on('pour_attributed', (e) => {
    broadcast(JSON.stringify({
      type: 'pour_attributed',
      drinkerId: e.drinkerId,
      pourId: e.pourId,
      tapId: e.tapId,
      tapNumber: e.tapNumber,
      beerName: e.beerName,
      volumeMl: e.volumeMl,
      pourCount: e.pourCount,
      ts: e.ts,
    }));
  });

  // Presence (Plan A Task 4): power-stage relay. Broadcast to every client like the
  // rest of this feed — frames carry wallSlug and clients filter for their own wall.
  app.ctx.bus.on('display_power_changed', (e) => {
    broadcast(JSON.stringify({
      type: 'display_power', wallId: e.wallId, wallSlug: e.wallSlug, state: e.state, ts: e.ts,
    }));
  });

  // Displays & Presence hub Task 3: motion-source wake relay — lets an open admin/kiosk
  // client show "motion just fired" without polling GET /api/presence/sources. Broadcast
  // to every client like the rest of this feed (same as display_power_changed above);
  // `sourceId` defaults to `null` for a legacy/anonymous wake (no registry entry fired
  // it — see core/motionSources.ts's `trigger()`).
  app.ctx.bus.on('motion_detected', (e) => {
    broadcast(JSON.stringify({
      type: 'motion', sourceId: e.sourceId ?? null, wallSlug: e.wallSlug, ts: e.ts,
    }));
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
    broadcast(JSON.stringify({ type: 'ping', ts: new Date().toISOString() }));
  }, pingIntervalMs);
  app.addHook('onClose', () => {
    clearInterval(pingInterval);
  });

  // The live feed is a display surface: gated behind the display token (via ?displayToken=,
  // since a browser WebSocket can't set headers) when enforcement is on. The preHandler runs
  // on the HTTP upgrade request and rejects it with 401 before the socket opens if unpaired.
  app.get('/ws', { websocket: true, preHandler: requireDisplayToken(app) }, (socket) => {
    clients.add(socket);
    socket.send(snapshot());
    // Replay current power stages so a reconnecting kiosk lands in the right stage
    // immediately (mirrors the SSE endpoint's on-connect replay guarantee).
    for (const z of app.ctx.presence.snapshot()) {
      socket.send(JSON.stringify({
        type: 'display_power', wallId: z.wallId, wallSlug: z.slug, state: z.state,
        ts: new Date().toISOString(),
      }));
    }
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
}
