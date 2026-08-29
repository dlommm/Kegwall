import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { requireDisplayToken } from './displayAuth.js';
import { ratePour } from '../db/pours.js';
import { listUdpActivity, summarizeUdpActivity } from '../db/udpActivity.js';
import { getUser } from '../db/users.js';
import { getBeer } from '../db/beers.js';
import { getKeg } from '../db/kegs.js';
import { logCleaning, listCleanings, cleaningStatus } from '../db/cleanings.js';
import { listTaps } from '../db/taps.js';
import { analyticsKpis, hourHeatmap } from '../db/stats.js';
import { MdashClient } from '../ingest/kegtron/mdashClient.js';
import { testMqttConnection } from '../notify/mqttSender.js';
import { NotFoundError } from '../core/errors.js';

/** Rate-after-claim quick tags (design 6a). */
export const RATING_TAGS = ['Crisp', 'Perfect temp', 'Foamy', 'Flat', 'Off flavor'] as const;

/** How long after a pour a rating is still accepted. */
const RATE_WINDOW_HOURS = 24;

/**
 * Pour Wall overhaul Phase 6 feature routes: ambient sensors, rate-after-claim
 * + passport (6a), session mode (6c), line cleaning (6e), Analytics KPI/heatmap
 * data (10a), and the Connection doctor's server-side checks (11e).
 */
export async function featurePackRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };

  // --- Ambient sensors (Govee) ---------------------------------------------

  // Exclusion filter (not include-only): a sensor whose monitors row hasn't been
  // created yet still lists, while a disabled row hides even a stale registry entry
  // left from before the disable (e.g. restart-then-disable-before-first-poll).
  app.get('/api/public/sensors', async () => {
    const disabled = new Set((db.prepare(
      `SELECT identifier FROM monitors WHERE type = 'govee_sensor' AND enabled = 0`,
    ).all() as { identifier: string }[]).map((r) => r.identifier));
    return app.ctx.sensors.list().filter((r) => !disabled.has(r.sensorId));
  });

  // --- Rate-after-claim (6a) -----------------------------------------------

  app.post('/api/public/pours/:id/rate', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const pourId = z.coerce.number().int().parse((req.params as any).id);
    const body = z.object({
      rating: z.number().int().min(1).max(5),
      tags: z.array(z.enum(RATING_TAGS)).max(RATING_TAGS.length).default([]),
      // The pour's claimant — a rating is bound to whoever claimed the pour, so a passerby
      // can't rate someone else's pour. The claim flow already knows this id.
      drinkerId: z.number().int(),
    }).parse(req.body);
    const row = db.prepare('SELECT ts, drinker_id FROM pours WHERE id = ?').get(pourId) as
      { ts: string; drinker_id: number | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such pour' });
    if (row.drinker_id === null) {
      return reply.code(400).send({ error: 'validation', message: 'Claim the pour before rating it' });
    }
    if (row.drinker_id !== body.drinkerId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only the claimant can rate this pour' });
    }
    if (Date.now() - new Date(row.ts).getTime() > RATE_WINDOW_HOURS * 3600 * 1000) {
      return reply.code(400).send({ error: 'validation', message: 'Rating window closed' });
    }
    return ratePour(db, pourId, body.rating, body.tags);
  });

  // --- Passport (6a): a pourer's own stats/badges --------------------------

  // Per-person drinking history — real PII and a display surface, so gated behind the
  // display token when enforcement is on (dormant otherwise).
  app.get('/api/public/passport/:drinkerId', {
    preHandler: requireDisplayToken(app),
  }, async (req, reply) => {
    const drinkerId = z.coerce.number().int().parse((req.params as any).drinkerId);
    const drinker = getUser(db, drinkerId);
    if (!drinker || !drinker.isDrinker) {
      return reply.code(404).send({ error: 'not_found', message: 'No such pourer' });
    }
    const totals = db.prepare(
      'SELECT COUNT(*) c, COALESCE(SUM(volume_ml), 0) v, AVG(quality) q FROM pours WHERE drinker_id = ?',
    ).get(drinkerId) as { c: number; v: number; q: number | null };
    const styles = db.prepare(`
      SELECT COUNT(DISTINCT b.style) c
      FROM pours p JOIN kegs k ON k.id = p.keg_id JOIN beers b ON b.id = k.beer_id
      WHERE p.drinker_id = ? AND b.style IS NOT NULL
    `).get(drinkerId) as { c: number };
    const recent = db.prepare(`
      SELECT p.id, p.ts, p.volume_ml, p.rating, b.name AS beer_name
      FROM pours p JOIN kegs k ON k.id = p.keg_id JOIN beers b ON b.id = k.beer_id
      WHERE p.drinker_id = ? ORDER BY p.ts DESC LIMIT 8
    `).all(drinkerId) as { id: number; ts: string; volume_ml: number; rating: number | null; beer_name: string }[];
    // First to try: beers where this pourer's claimed pour is the earliest claimed pour.
    const firsts = db.prepare(`
      SELECT COUNT(*) c FROM (
        SELECT k.beer_id, MIN(p.ts) AS first_ts,
               (SELECT p2.drinker_id FROM pours p2 JOIN kegs k2 ON k2.id = p2.keg_id
                WHERE k2.beer_id = k.beer_id AND p2.drinker_id IS NOT NULL
                ORDER BY p2.ts LIMIT 1) AS first_drinker
        FROM pours p JOIN kegs k ON k.id = p.keg_id
        WHERE p.drinker_id IS NOT NULL GROUP BY k.beer_id
      ) WHERE first_drinker = ?
    `).get(drinkerId) as { c: number };

    const badges: string[] = [];
    if (totals.c >= 1) badges.push('First pour');
    if (totals.c >= 100) badges.push('Century Club');
    if (firsts.c >= 1) badges.push(`First to try ×${firsts.c}`);
    if (styles.c >= 5) badges.push('Style explorer');
    if (totals.q != null && totals.q >= 90) badges.push('Smooth operator');

    return {
      drinker: { id: drinker.id, displayName: drinker.displayName, avatarColor: drinker.avatarColor },
      pourCount: totals.c,
      volumeMl: totals.v,
      stylesTried: styles.c,
      avgQuality: totals.q != null ? Math.round(totals.q) : null,
      badges,
      recent: recent.map((r) => ({
        id: r.id, ts: r.ts, volumeMl: r.volume_ml, rating: r.rating, beerName: r.beer_name,
      })),
    };
  });

  // --- Session mode (6c) ----------------------------------------------------

  app.post('/api/public/session/start', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const body = z.object({ name: z.string().trim().max(60).optional() }).parse(req.body ?? {});
    const session = app.ctx.session.start(body.name);
    app.ctx.log.info('tablet', `Session started — "${session.name}"`);
    return app.ctx.session.snapshot(db);
  });

  app.post('/api/public/session/join', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({ drinkerId: z.number().int() }).parse(req.body);
    const drinker = getUser(db, body.drinkerId);
    if (!drinker || !drinker.isDrinker) {
      return reply.code(400).send({ error: 'validation', message: 'No such pourer' });
    }
    const session = app.ctx.session.join({
      drinkerId: drinker.id, name: drinker.displayName, color: drinker.avatarColor,
    });
    if (!session) return reply.code(409).send({ error: 'conflict', message: 'No active session' });
    return app.ctx.session.snapshot(db);
  });

  app.get('/api/public/session', async () => app.ctx.session.snapshot(db) ?? { active: false });

  app.post('/api/public/session/end', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const recap = app.ctx.session.end(db);
    if (!recap) return reply.code(409).send({ error: 'conflict', message: 'No active session' });
    app.ctx.log.info('tablet', `Session ended — "${recap.name}", ${recap.totals.reduce((s, t) => s + t.pourCount, 0)} pours`);
    return recap;
  });

  // --- Line cleaning (6e) ---------------------------------------------------

  app.get('/api/taps/:id/cleanings', viewer, async (req) => {
    const tapId = z.coerce.number().int().parse((req.params as any).id);
    return {
      status: cleaningStatus(db, tapId),
      cleanings: listCleanings(db, tapId),
    };
  });

  app.get('/api/cleanings/status', viewer, async () => listTaps(db)
    .map((tap) => cleaningStatus(db, tap.id)));

  app.post('/api/taps/:id/cleanings', editor, async (req, reply) => {
    const tapId = z.coerce.number().int().parse((req.params as any).id);
    // `cleanedAt` (redesign 4a — backdating) is an optional ISO timestamp; a future date is
    // rejected (you can't have cleaned a line tomorrow), a past one recomputes the counters.
    const body = z.object({
      note: z.string().max(200).optional(),
      cleanedAt: z.string().datetime().optional(),
    }).refine((v) => v.cleanedAt == null || new Date(v.cleanedAt).getTime() <= Date.now(), {
      message: 'cleanedAt cannot be in the future', path: ['cleanedAt'],
    }).parse(req.body ?? {});
    const taps = listTaps(db);
    if (!taps.some((t) => t.id === tapId)) throw new NotFoundError(`tap ${tapId}`);
    const cleaning = logCleaning(db, tapId, body.note, body.cleanedAt);
    app.ctx.log.info('app', `Line cleaned — tap #${tapId}${body.cleanedAt ? ' (backdated)' : ''}${body.note ? ` (${body.note})` : ''}`);
    reply.code(201);
    return cleaning;
  });

  // --- Analytics data (10a) -------------------------------------------------

  const rangeSchema = z.object({
    // '7' matches the Analytics page's smallest range switcher — without it the client
    // had to floor 7d to a 30-day KPI/heatmap window while the charts beside them were
    // genuinely 7-day (the "range mismatch" fix).
    days: z.enum(['7', '30', '90', '365']).default('30').transform(Number),
  });

  // Money KPIs (costPerPint, valueOnTap) are owner cost — nulled for viewer accounts
  // unless the owner opts viewers in via `pricing.showCostsToViewers` (H2 follow-up;
  // same policy as crud.ts's keg redaction). Editors/admins always get them.
  app.get('/api/stats/kpis', viewer, async (req) => {
    const kpis = analyticsKpis(db, rangeSchema.parse(req.query).days);
    if (req.user?.role === 'viewer' && !app.ctx.settings.get('pricing').showCostsToViewers) {
      return { ...kpis, costPerPintCents: null, valueOnTapCents: null };
    }
    return kpis;
  });

  app.get('/api/stats/heatmap', viewer, async (req) => ({
    grid: hourHeatmap(db, rangeSchema.parse(req.query).days),
  }));

  // --- Connection doctor (11e) ---------------------------------------------

  // Cloud check: auth + device count + latency, straight against mdash.
  app.post('/api/doctor/cloud', editor, async () => {
    const apiKey = app.ctx.settings.get('kegtronApiKey');
    if (!apiKey) {
      return { ok: false, detail: 'No Kegtron cloud API key configured' };
    }
    const client = new MdashClient({ apiKey, baseUrl: app.ctx.settings.get('kegtronBaseUrl') });
    const started = Date.now();
    try {
      const customer = await client.getCustomer();
      const latencyMs = Date.now() - started;
      const detail = `Auth OK — ${customer.devicePubkeys.length} device(s), ${latencyMs}ms`;
      app.ctx.log.info('kegtron', `Doctor: cloud check — ${detail}`);
      return { ok: true, deviceCount: customer.devicePubkeys.length, latencyMs, detail };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Cloud request failed';
      app.ctx.log.error('kegtron', `Doctor: cloud check failed — ${detail}`);
      return { ok: false, detail };
    }
  });

  // MQTT broker connectivity check for the HA setup wizard. Editor-gated (same as the other
  // doctor checks) — an editor already configures mqtt.url, so this connects to the same
  // broker, just before saving. A blank/masked password falls back to the stored secret, so
  // the admin can re-test an existing config without re-typing it.
  app.post('/api/doctor/mqtt', editor, async (req) => {
    const body = z.object({
      url: z.string().min(1),
      username: z.string().optional(),
      password: z.string().optional(),
    }).parse(req.body);
    const saved = app.ctx.settings.get('mqtt');
    const password = body.password && !body.password.startsWith('••••')
      ? body.password
      : saved?.password;
    return testMqttConnection({ url: body.url, username: body.username ?? saved?.username, password });
  });

  // UDP/live-path check (design: "30s listen … pour now to prove the live path"):
  // counts live bus events per monitor over a short window. Works for every
  // source, and a pour during the window proves the whole ingest path.
  // Rolling in-memory ring of the last raw UDP datagrams — the "save the UDP data"
  // request, scoped sanely: raw payloads are ~1KB at 4/sec, so persisting them all
  // would grind the SD card for no diagnostic gain. The last 50 on demand + the
  // per-minute udp_activity timeline below cover every real investigation.
  const RAW_RING_SIZE = 50;
  const rawRing: { raw: string; ts: string; serial?: string }[] = [];
  app.ctx.bus.on('udp_packet_raw', (e) => {
    rawRing.push(e);
    if (rawRing.length > RAW_RING_SIZE) rawRing.shift();
  });

  app.get('/api/doctor/udp-raw', editor, async () => ({ packets: [...rawRing].reverse() }));

  // The persisted receipt timeline (db/udpActivity.ts): per-device coverage + the
  // largest silent gaps — the evidence for "works, then dies after N quiet minutes"
  // (IGMP snooping ageing) vs "stopped at 21:04 and never came back" (device toggle).
  app.get('/api/doctor/udp-history', editor, async (req) => {
    const { hours } = z.object({
      hours: z.coerce.number().int().min(1).max(24 * 14).default(24),
    }).parse(req.query ?? {});
    const now = new Date();
    const endMinute = now.toISOString().slice(0, 16);
    const sinceMinute = new Date(now.getTime() - hours * 3_600_000).toISOString().slice(0, 16);
    const devices = summarizeUdpActivity(listUdpActivity(app.ctx.db, sinceMinute), endMinute);
    return { hours, devices };
  });

  app.post('/api/doctor/listen', editor, async (req) => {
    const body = z.object({ seconds: z.number().int().min(3).max(30).default(10) }).parse(req.body ?? {});
    // Count ONLY genuine UDP packets. This test's whole purpose is proving the UDP
    // live path, but it originally counted volume_update/pour_* from ANY source —
    // and Kegtron's cloud notify channel pushes shadow updates at a per-second-ish
    // cadence, so a dead UDP path still "passed" with dozens of events (observed on
    // real hardware: 41 cloud events while UDP had been silent for 35 minutes).
    // The UDP source emits a healthy source_status per parsed packet with the serial
    // in its detail (udpSource.ts) — that's the packet-level signal, keyed per device.
    const counts = new Map<string, number>();
    // A few raw datagrams (malformed included — udpSource taps them BEFORE parsing)
    // so an admin can see exactly what's on the wire, not just a count.
    const rawSamples: { raw: string; ts: string }[] = [];
    const offs = [
      app.ctx.bus.on('source_status', (e) => {
        if (e.source !== 'kegtron_udp' || !e.healthy) return;
        const m = /^last packet from (\S+) /.exec(e.detail);
        if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
      }),
      app.ctx.bus.on('udp_packet_raw', (e) => {
        if (rawSamples.length < 5) rawSamples.push(e);
      }),
    ];
    await new Promise((resolve) => { setTimeout(resolve, body.seconds * 1000); });
    offs.forEach((off) => off());
    const perMonitor = [...counts.entries()].map(([monitor, events]) => ({ monitor, events }));
    const total = perMonitor.reduce((sum, m) => sum + m.events, 0);
    app.ctx.log.info('kegtron', `Doctor: ${body.seconds}s UDP listen — ${total} packet(s) across ${perMonitor.length} device(s)`);
    return {
      seconds: body.seconds, total, perMonitor, rawSamples,
    };
  });

  // Network-mode check (design: "detects Docker bridge and links the host-network fix").
  app.get('/api/doctor/env', editor, async () => {
    let inDocker = existsSync('/.dockerenv');
    if (!inDocker) {
      try {
        inDocker = readFileSync('/proc/1/cgroup', 'utf8').includes('docker');
      } catch {
        // not linux / not readable — fine
      }
    }
    return {
      inDocker,
      hint: inDocker
        ? 'Running in Docker. Kegtron UDP multicast (239.50.50.50:50505) does not cross the default bridge network — run the container with --network host (Linux) so the packets reach it.'
        : 'Not containerized — UDP broadcasts reach this process directly.',
    };
  });

  // Govee freshness check.
  app.post('/api/doctor/govee', editor, async () => {
    const config = app.ctx.settings.get('govee');
    if (!config?.apiKey) return { ok: false, detail: 'No Govee API key configured' };
    const readings = app.ctx.sensors.list();
    if (readings.length === 0) return { ok: false, detail: 'No sensor readings yet — check the key and wait one poll (~60s)' };
    const newest = Math.max(...readings.map((r) => new Date(r.ts).getTime()));
    const ageS = Math.round((Date.now() - newest) / 1000);
    return {
      ok: ageS < 180,
      sensorCount: readings.length,
      newestAgeSeconds: ageS,
      detail: `${readings.length} sensor(s), newest reading ${ageS}s ago`,
    };
  });
}
