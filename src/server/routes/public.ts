import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getWallBySlug } from './crud.js';
import { recentUnclaimedPours, setPourDrinker } from '../db/pours.js';
import { listDrinkers } from '../db/users.js';
import { getKeg } from '../db/kegs.js';
import { getBeer } from '../db/beers.js';
import { listTaps } from '../db/taps.js';
import { wallConfigSchema, type WallConfig } from '../core/wallConfig.js';

export async function publicRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  app.get('/api/public/wall/:slug', async (req, reply) => {
    const wall = getWallBySlug(db, (req.params as any).slug);
    if (!wall) return reply.code(404).send({ error: 'not_found', message: 'No such wall' });
    const config = wallConfigSchema.parse(wall.config) as WallConfig;
    let taps = app.ctx.state.getTapStates();
    const configured = new Set(config.pages.flatMap((p) => p.tapIds));
    if (configured.size > 0) taps = taps.filter((t) => configured.has(t.tapId));
    return {
      wall: { slug: wall.slug, name: wall.name, config },
      taps,
      units: app.ctx.settings.get('displayUnits'),
    };
  });

  app.get('/api/public/menu', async () => ({
    siteName: app.ctx.settings.get('siteName'),
    taps: app.ctx.state.getTapStates(),
    units: app.ctx.settings.get('displayUnits'),
  }));

  app.get('/api/public/drinkers', async () =>
    listDrinkers(db).map((d) => ({
      id: d.id, displayName: d.displayName, avatarColor: d.avatarColor,
    })));

  app.get('/api/public/recent-pours', async () => {
    const tapByNumber = new Map(listTaps(db).map((t) => [t.id, t.number]));
    return recentUnclaimedPours(db, 15).map((p) => {
      const keg = getKeg(db, p.kegId)!;
      const beer = getBeer(db, keg.beerId);
      return {
        id: p.id, ts: p.ts, volumeMl: p.volumeMl,
        tapNumber: keg.tapId ? tapByNumber.get(keg.tapId) ?? null : null,
        beerName: beer?.name ?? 'Unknown',
      };
    });
  });

  app.post('/api/public/claim', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({
      pourId: z.number().int(), drinkerId: z.number().int(),
    }).parse(req.body);
    const existing = db.prepare('SELECT drinker_id FROM pours WHERE id = ?')
      .get(body.pourId) as any;
    if (!existing) return reply.code(404).send({ error: 'not_found', message: 'No such pour' });
    if (existing.drinker_id !== null) {
      return reply.code(409).send({ error: 'conflict', message: 'Pour already claimed' });
    }
    const drinker = db.prepare('SELECT id FROM users WHERE id = ? AND is_drinker = 1')
      .get(body.drinkerId);
    if (!drinker) {
      return reply.code(400).send({ error: 'validation', message: 'No such drinker' });
    }
    const pour = setPourDrinker(db, body.pourId, body.drinkerId);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return pour;
  });
}
