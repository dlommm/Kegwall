import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';

/**
 * Viewer cost redaction (H2 follow-up to redesign 4k/4l): owner cost/sourcing on
 * viewer-gated reads is hidden from viewer accounts unless the owner opts them in
 * via `pricing.showCostsToViewers`. Editors/admins always see costs (editors can
 * already write them). This is about AUTHENTICATED viewers — the public/unauthenticated
 * cost invariant has its own tests in public.test.ts and must never depend on this toggle.
 */

let app: FastifyInstance;
let adminCookies: { session: string };
let viewerCookies: { session: string };
let editorCookies: { session: string };
let tapId: number;

async function cookieFor(username: string, password: string): Promise<{ session: string }> {
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username, password },
  });
  const c = login.cookies.find((c: any) => c.name === 'session')!;
  return { session: c.value };
}

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  adminCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
  for (const [u, role] of [['vw', 'viewer'], ['ed', 'editor']] as const) {
    const res = await app.inject({
      method: 'POST', url: '/api/users', cookies: adminCookies,
      payload: { username: u, displayName: u.toUpperCase(), password: 'password1', role },
    });
    expect(res.statusCode).toBe(201);
  }
  viewerCookies = await cookieFor('vw', 'password1');
  editorCookies = await cookieFor('ed', 'password1');

  const db = app.ctx.db;
  const beer = createBeer(db, { name: 'Citra IPA' });
  const tap = createTap(db, { number: 1 });
  tapId = tap.id;
  const keg = createKeg(db, {
    beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
    costCents: 13100, depositCents: 3000, purchasedAt: '2026-08-01',
  });
  // A costed pour so /api/stats/kpis has a non-null costPerPintCents to redact.
  recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 473, source: 'udp' });
  // And a queued on-deck keg with a cost for the on-deck endpoint.
  createKeg(db, {
    beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
    status: 'on_deck', costCents: 9900, depositCents: 3000,
  });
});
afterEach(async () => { await app.close(); });

function optIn() {
  const pricing = app.ctx.settings.get('pricing');
  app.ctx.settings.set('pricing', { ...pricing, showCostsToViewers: true });
}

describe('viewer cost redaction', () => {
  it('GET /api/kegs nulls owner cost/sourcing for viewers by default, keeps it for editor/admin', async () => {
    for (const cookies of [adminCookies, editorCookies]) {
      const res = await app.inject({ method: 'GET', url: '/api/kegs', cookies });
      expect(res.statusCode).toBe(200);
      const costed = res.json().find((k: any) => k.costCents === 13100);
      expect(costed).toBeTruthy();
      expect(costed.depositCents).toBe(3000);
      expect(costed.purchasedAt).toBe('2026-08-01');
    }
    const viewer = await app.inject({ method: 'GET', url: '/api/kegs', cookies: viewerCookies });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json().length).toBeGreaterThan(0);
    for (const k of viewer.json()) {
      expect(k.costCents).toBeNull();
      expect(k.depositCents).toBeNull();
      expect(k.supplierId).toBeNull();
      expect(k.purchasedAt).toBeNull();
    }
    expect(viewer.body).not.toContain('13100');
  });

  it('GET /api/taps/:id/on-deck redacts the queue for viewers by default', async () => {
    const admin = await app.inject({ method: 'GET', url: `/api/taps/${tapId}/on-deck`, cookies: adminCookies });
    expect(admin.json()[0].costCents).toBe(9900);
    const viewer = await app.inject({ method: 'GET', url: `/api/taps/${tapId}/on-deck`, cookies: viewerCookies });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json()[0].costCents).toBeNull();
    expect(viewer.body).not.toContain('9900');
  });

  it('GET /api/stats/kpis nulls the money KPIs for viewers by default', async () => {
    const admin = await app.inject({ method: 'GET', url: '/api/stats/kpis', cookies: adminCookies });
    expect(admin.json().costPerPintCents).toBeGreaterThan(0);
    expect(admin.json().valueOnTapCents).toBeGreaterThan(0);
    const viewer = await app.inject({ method: 'GET', url: '/api/stats/kpis', cookies: viewerCookies });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json().costPerPintCents).toBeNull();
    expect(viewer.json().valueOnTapCents).toBeNull();
    // Non-money KPIs stay intact for viewers.
    expect(viewer.json().pours).toBe(admin.json().pours);
  });

  it('GET /api/stats/kpis accepts days=7 (the Analytics 7d switcher) and rejects other values', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/stats/kpis?days=7', cookies: adminCookies });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pours).toBeGreaterThan(0);
    const bad = await app.inject({ method: 'GET', url: '/api/stats/kpis?days=14', cookies: adminCookies });
    expect(bad.statusCode).toBe(400);
  });

  it('pricing.showCostsToViewers = true opts viewers into all three endpoints', async () => {
    optIn();
    const kegs = await app.inject({ method: 'GET', url: '/api/kegs', cookies: viewerCookies });
    expect(kegs.json().some((k: any) => k.costCents === 13100)).toBe(true);
    const onDeck = await app.inject({ method: 'GET', url: `/api/taps/${tapId}/on-deck`, cookies: viewerCookies });
    expect(onDeck.json()[0].costCents).toBe(9900);
    const kpis = await app.inject({ method: 'GET', url: '/api/stats/kpis', cookies: viewerCookies });
    expect(kpis.json().costPerPintCents).toBeGreaterThan(0);
    expect(kpis.json().valueOnTapCents).toBeGreaterThan(0);
  });
});
