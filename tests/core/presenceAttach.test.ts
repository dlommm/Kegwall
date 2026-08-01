import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { attachPresence } from '../../src/server/core/presenceAttach.js';

describe('attachPresence', () => {
  let db: ReturnType<typeof openDb>;
  let bus: EventBus;
  beforeEach(() => {
    vi.useFakeTimers();
    db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
    bus = new EventBus();
  });
  afterEach(() => { vi.useRealTimers(); db.close(); });

  function insertWall(slug: string, config: object): number {
    const r = db.prepare('INSERT INTO walls (slug, name, config) VALUES (?, ?, ?)')
      .run(slug, slug, JSON.stringify(config));
    return Number(r.lastInsertRowid);
  }

  it('builds one zone per wall from displayPower config', () => {
    insertWall('main', { displayPower: { screensaverAfterMinutes: 10, offAfterMinutes: 60 } });
    insertWall('patio', {});
    const reg = attachPresence(db, bus);
    expect(reg.snapshot().map((z) => z.slug).sort()).toEqual(['main', 'patio']);
    vi.advanceTimersByTime(10 * 60_000);
    expect(reg.stateOf('main')).toBe('screensaver');
    expect(reg.stateOf('patio')).toBe('active'); // defaults: timers null
    reg.stop();
  });

  it('reconfigures on state_changed scope walls', () => {
    const reg = attachPresence(db, bus);
    expect(reg.snapshot()).toHaveLength(0);
    insertWall('main', { displayPower: { screensaverAfterMinutes: 5, offAfterMinutes: null } });
    bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    expect(reg.stateOf('main')).toBe('active');
    reg.stop();
  });

  it('pour_started wakes every zone', () => {
    insertWall('main', { displayPower: { screensaverAfterMinutes: 5, offAfterMinutes: null } });
    const reg = attachPresence(db, bus);
    vi.advanceTimersByTime(5 * 60_000);
    expect(reg.stateOf('main')).toBe('screensaver');
    bus.emit('pour_started', {
      monitor: { type: 'kegtron_pro', identifier: 'x', portIndex: 0 },
      ts: new Date().toISOString(),
    });
    expect(reg.stateOf('main')).toBe('active');
    reg.stop();
  });

  it('honors a legacy screensaver config via parseWallConfig', () => {
    insertWall('main', { screensaver: { enabled: true, startAfterMinutes: 7 } });
    const reg = attachPresence(db, bus);
    vi.advanceTimersByTime(7 * 60_000);
    expect(reg.stateOf('main')).toBe('screensaver');
    reg.stop();
  });
});
