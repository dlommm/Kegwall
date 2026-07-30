import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { LogService } from '../../src/server/core/logService.js';
import { SensorRegistry, SPREAD_ALERT_F } from '../../src/server/core/sensorRegistry.js';
import { attachBeerAutoImport } from '../../src/server/core/beerAutoImport.js';
import { attachMilestones, POUR_MILESTONE_EVERY } from '../../src/server/core/milestones.js';
import { SessionRegistry } from '../../src/server/core/sessionMode.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker } from '../../src/server/db/users.js';
import { logCleaning, cleaningStatus } from '../../src/server/db/cleanings.js';
import { diffToEvents, parseDeviceShadow } from '../../src/server/ingest/kegtron/shadow.js';
import { analyticsKpis, hourHeatmap } from '../../src/server/db/stats.js';

let db: Database.Database;
let bus: EventBus;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
});

describe('beer auto-import (design 6g)', () => {
  it('caches an unseen device beer and banners the wall; known names are left alone', () => {
    const settings = new SettingsStore(db);
    const log = new LogService(db, bus);
    attachBeerAutoImport(db, bus, settings, log);
    const banner = vi.fn();
    bus.on('wall_banner', banner);

    bus.emit('beer_seen', {
      monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
      name: 'West Coast Thunder', maker: 'Halfmoon', style: 'IPA', abv: 6.5, ibu: 60, srm: 7,
      ts: new Date().toISOString(),
    });
    const row = db.prepare('SELECT * FROM beers WHERE name = ?').get('West Coast Thunder') as any;
    expect(row.style).toBe('IPA');
    expect(row.abv).toBe(6.5);
    expect(banner).toHaveBeenCalledTimes(1);

    // Same name again (case-insensitive) — no duplicate, no second banner.
    bus.emit('beer_seen', {
      monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
      name: 'WEST COAST THUNDER', maker: null, style: null, abv: null, ibu: null, srm: null,
      ts: new Date().toISOString(),
    });
    expect((db.prepare("SELECT COUNT(*) c FROM beers").get() as any).c).toBe(1);
    expect(banner).toHaveBeenCalledTimes(1);
  });

  it('respects the autoImportBeers setting', () => {
    const settings = new SettingsStore(db);
    settings.set('autoImportBeers', false);
    attachBeerAutoImport(db, bus, settings, new LogService(db, bus));
    bus.emit('beer_seen', {
      monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
      name: 'Quiet Beer', maker: null, style: null, abv: null, ibu: null, srm: null,
      ts: new Date().toISOString(),
    });
    expect((db.prepare('SELECT COUNT(*) c FROM beers').get() as any).c).toBe(0);
  });
});

describe('shadow diff emits beer_seen', () => {
  const shadow = (name: string) => parseDeviceShadow({
    id: 'dev1',
    shadow: {
      state: {
        reported: {
          config: { port0: { userName: name, style: 'IPA', abv: 6.5, state: 1 } },
          config_readonly: {
            serialNum: 'SN', portCount: 1,
            port0: { volStart: 19000, volDisp: 100 },
          },
          online: true,
        },
      },
    },
  })!;

  it('fires on first sight and on a name change, not on every poll', () => {
    const first = diffToEvents('dev1', null, shadow('Cloud Cover'));
    expect(first.filter((e) => e.event === 'beer_seen')).toHaveLength(1);

    const same = diffToEvents('dev1', shadow('Cloud Cover'), shadow('Cloud Cover'));
    expect(same.filter((e) => e.event === 'beer_seen')).toHaveLength(0);

    const changed = diffToEvents('dev1', shadow('Cloud Cover'), shadow('Morning Line'));
    const seen = changed.filter((e) => e.event === 'beer_seen');
    expect(seen).toHaveLength(1);
    expect((seen[0]!.payload as any).name).toBe('Morning Line');
  });
});

describe('milestones (design 6f)', () => {
  it('banners every Nth pour and a keg kick', () => {
    attachMilestones(db, bus);
    const banner = vi.fn();
    bus.on('wall_banner', banner);
    const beer = createBeer(db, { name: 'IPA' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 190000, volStartMl: 190000, tapId: tap.id });

    for (let i = 0; i < POUR_MILESTONE_EVERY; i += 1) {
      recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 100, source: 'udp' });
      bus.emit('pour_completed', {
        monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
        volumeMl: 100, durationMs: null, source: 'udp', ts: new Date().toISOString(),
      });
    }
    // Pour counts pass through every value 1..100 — exactly one milestone.
    const milestoneCalls = banner.mock.calls.filter(([b]) => (b as any).text.includes('POUR #'));
    expect(milestoneCalls).toHaveLength(1);

    bus.emit('keg_kicked', { tapId: tap.id, kegId: keg.id, beerId: beer.id, ts: new Date().toISOString() });
    expect(banner.mock.calls.some(([b]) => (b as any).text.includes('KEG KICKED'))).toBe(true);
  });
});

describe('sensor registry (Govee, Phase 6)', () => {
  it('keeps the latest reading per sensor and warns once on a >2.5°F spread', () => {
    const log = new LogService(db, bus);
    const warn = vi.spyOn(log, 'warn');
    const registry = new SensorRegistry(bus, log);
    registry.attach();

    bus.emit('sensor_reading', { sensorId: 'a', name: 'FRONT', tempC: 1.0, humidity: 60, ts: 't1' });
    bus.emit('sensor_reading', { sensorId: 'b', name: 'BACK', tempC: 1.2, humidity: 58, ts: 't1' });
    expect(registry.list()).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();

    // Spread: 1.0°C vs 3.0°C = 3.6°F > threshold.
    bus.emit('sensor_reading', { sensorId: 'b', name: 'BACK', tempC: 3.0, humidity: 58, ts: 't2' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toContain(`${SPREAD_ALERT_F}`);

    // Still spread — no re-alert; back in range resets the latch.
    bus.emit('sensor_reading', { sensorId: 'b', name: 'BACK', tempC: 3.1, humidity: 58, ts: 't3' });
    expect(warn).toHaveBeenCalledTimes(1);
    bus.emit('sensor_reading', { sensorId: 'b', name: 'BACK', tempC: 1.1, humidity: 58, ts: 't4' });
    bus.emit('sensor_reading', { sensorId: 'b', name: 'BACK', tempC: 3.0, humidity: 58, ts: 't5' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('remove() drops a sensor immediately (the disable path), and it stays gone until it reports again', () => {
    const log = new LogService(db, bus);
    const registry = new SensorRegistry(bus, log);
    registry.attach();

    bus.emit('sensor_reading', { sensorId: 'a', name: 'FRONT', tempC: 1.0, humidity: 60, ts: 't1' });
    bus.emit('sensor_reading', { sensorId: 'b', name: 'BACK', tempC: 1.2, humidity: 58, ts: 't1' });
    registry.remove('a');
    expect(registry.list().map((r) => r.sensorId)).toEqual(['b']);

    // A fresh reading (sensor re-enabled → poller feeds it again) restores it.
    bus.emit('sensor_reading', { sensorId: 'a', name: 'FRONT', tempC: 1.1, humidity: 60, ts: 't2' });
    expect(registry.list()).toHaveLength(2);
  });
});

describe('session mode (design 6c)', () => {
  it('computes per-member totals from pours since start, and ends with a recap', () => {
    const registry = new SessionRegistry();
    const beer = createBeer(db, { name: 'IPA' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    const sam = createDrinker(db, { displayName: 'Sam' });
    const jt = createDrinker(db, { displayName: 'JT' });

    // A pour BEFORE the session must not count.
    recordPourTx(db, { kegId: keg.id, ts: new Date(Date.now() - 60_000).toISOString(), volumeMl: 999, source: 'udp', drinkerId: sam.id });

    registry.start('Game night');
    registry.join({ drinkerId: sam.id, name: 'Sam', color: null });
    registry.join({ drinkerId: jt.id, name: 'JT', color: null });
    registry.join({ drinkerId: sam.id, name: 'Sam', color: null }); // idempotent

    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 400, source: 'udp', drinkerId: sam.id });
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 300, source: 'udp', drinkerId: sam.id });
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 200, source: 'udp', drinkerId: jt.id });

    const snapshot = registry.snapshot(db)!;
    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.totals[0]).toMatchObject({ name: 'Sam', pourCount: 2, volumeMl: 700 });
    expect(snapshot.totals[1]).toMatchObject({ name: 'JT', pourCount: 1, volumeMl: 200 });

    const recap = registry.end(db)!;
    expect(recap.name).toBe('Game night');
    expect(registry.current()).toBeNull();
  });
});

describe('line cleaning status (design 6e)', () => {
  it('reads due after volume or age, resets on a logged cleaning', () => {
    const beer = createBeer(db, { name: 'IPA' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 190000, volStartMl: 190000, tapId: tap.id });

    // Never cleaned + pours on record → due.
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 500, source: 'udp' });
    expect(cleaningStatus(db, tap.id).due).toBe(true);

    logCleaning(db, tap.id, 'BLC run');
    expect(cleaningStatus(db, tap.id).due).toBe(false);

    // 15+ gallons since the cleaning → due again.
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 16 * 3785.41, source: 'udp' });
    const status = cleaningStatus(db, tap.id);
    expect(status.gallonsSince).toBeGreaterThan(15);
    expect(status.due).toBe(true);
  });
});

describe('analytics KPIs + heatmap (design 10a)', () => {
  it('computes pours/volume/kicked/cost-per-pint/value-on-tap', () => {
    const beer = createBeer(db, { name: 'IPA' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    db.prepare('UPDATE kegs SET cost_cents = 12000 WHERE id = ?').run(keg.id); // $120 corny

    // Pour half the keg: cost consumed = $60 over 9500/473 ≈ 20.08 pints ≈ $2.99/pint.
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 9500, source: 'udp', quality: 90 });

    const kpis = analyticsKpis(db, 30);
    expect(kpis.pours).toBe(1);
    expect(kpis.volumeMl).toBe(9500);
    expect(kpis.avgQuality).toBe(90);
    expect(kpis.costPerPintCents).toBeGreaterThan(280);
    expect(kpis.costPerPintCents).toBeLessThan(320);
    // Half the $120 keg remains on tap.
    expect(kpis.valueOnTapCents).toBe(6000);
    expect(kpis.kegsKicked).toBe(0);

    db.prepare("UPDATE kegs SET status = 'kicked' WHERE id = ?").run(keg.id);
    expect(analyticsKpis(db, 30).kegsKicked).toBe(1);
  });

  it('heatmap buckets by local day-of-week × hour', () => {
    const beer = createBeer(db, { name: 'IPA' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    const now = new Date();
    recordPourTx(db, { kegId: keg.id, ts: now.toISOString(), volumeMl: 100, source: 'udp' });
    const grid = hourHeatmap(db, 30);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid[now.getDay()]![now.getHours()]).toBe(1);
  });
});
