import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore, parseMotionSources } from '../../src/server/db/settings.js';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import { PresenceRegistry } from '../../src/server/core/presence.js';
import { LogService } from '../../src/server/core/logService.js';
import { MotionSourceRegistry, migrateMotionTopics } from '../../src/server/core/motionSources.js';

function makeRegistry() {
  const db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  const bus = new EventBus();
  const settings = new SettingsStore(db);
  const presence = new PresenceRegistry(bus);
  presence.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: null, offAfterMinutes: null }]);
  const log = new LogService(db, bus);
  return { db, bus, settings, presence, log, registry: new MotionSourceRegistry(bus, presence, log, settings) };
}

const SRC = {
  id: 'abc-123', name: 'Kitchen PIR', type: 'mqtt' as const, enabled: true,
  wallSlug: 'main', config: { topic: 'home/pir', match: { mode: 'any' as const } },
};

describe('MotionSourceRegistry', () => {
  it('trigger(id) wakes the source wall, stamps lastTriggeredAt, tags motion_detected', () => {
    const { settings, presence, registry, bus } = makeRegistry();
    settings.set('motionSources', [SRC] as never);
    const events: EventMap['motion_detected'][] = [];
    bus.on('motion_detected', (e) => events.push(e));
    const spy = vi.spyOn(presence, 'motion');
    registry.trigger('abc-123');
    expect(spy).toHaveBeenCalledWith('main', 'mqtt', 'abc-123');
    expect(registry.statusOf('abc-123').lastTriggeredAt).not.toBeNull();
    expect(events[0]?.sourceId).toBe('abc-123');
  });

  it('trigger(null) wakes all walls and stamps nothing', () => {
    const { presence, registry } = makeRegistry();
    const spy = vi.spyOn(presence, 'motion');
    registry.trigger(null);
    expect(spy).toHaveBeenCalledWith(null, 'webhook', undefined);
  });

  it('unknown id wakes all walls (legacy) and does not throw', () => {
    const { presence, registry } = makeRegistry();
    const spy = vi.spyOn(presence, 'motion');
    registry.trigger('ghost');
    expect(spy).toHaveBeenCalled();
  });

  it('disabled sources are excluded from sources() and trigger() ignores them', () => {
    const { settings, presence, registry } = makeRegistry();
    settings.set('motionSources', [{ ...SRC, enabled: false }] as never);
    expect(registry.sources()).toHaveLength(0);
    const spy = vi.spyOn(presence, 'motion');
    registry.trigger('abc-123');
    expect(spy).not.toHaveBeenCalled();
  });

  // Task 3 ledgered fix: GET /api/presence/sources must be able to surface a derived
  // camera row's lastTriggeredAt by reading statusOf('camera:<slug>') — trigger()'s
  // camera sentinel branch has to stamp that entry itself, since there's no stored
  // registry row for it to stamp.
  it('trigger(camera:<slug>) wakes that wall as camera and stamps its own sentinel status entry', () => {
    const { presence, registry } = makeRegistry();
    const spy = vi.spyOn(presence, 'motion');
    expect(registry.statusOf('camera:main').lastTriggeredAt).toBeNull();
    registry.trigger('camera:main');
    expect(spy).toHaveBeenCalledWith('main', 'camera', 'camera:main');
    expect(registry.statusOf('camera:main').lastTriggeredAt).not.toBeNull();
  });

  it('markHealth round-trips through statusOf and snapshot', () => {
    const { settings, registry } = makeRegistry();
    settings.set('motionSources', [SRC] as never);
    registry.markHealth('abc-123', false, 'broker down');
    expect(registry.statusOf('abc-123')).toMatchObject({ healthy: false, detail: 'broker down' });
    expect(registry.snapshot()[0]?.status.healthy).toBe(false);
  });
});

describe('parseMotionSources', () => {
  it('drops malformed entries and keeps valid ones', () => {
    const out = parseMotionSources([SRC, { id: 'bad' }, 42]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('abc-123');
  });
  it('rejects an mqtt source without topic+match and a gpio source without line', () => {
    expect(parseMotionSources([{ ...SRC, config: {} }])).toHaveLength(0);
    expect(parseMotionSources([{ ...SRC, type: 'gpio', config: {} }])).toHaveLength(0);
  });
});

describe('migrateMotionTopics', () => {
  it('converts legacy topics once, idempotently', () => {
    const { settings, log } = makeRegistry();
    settings.set('mqtt', {
      url: 'mqtt://x', motionTopics: [{ topic: 'home/pir', wallSlug: 'main' }],
    } as never);
    migrateMotionTopics(settings, log);
    const sources = settings.get('motionSources') as unknown[];
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ type: 'mqtt', name: 'home/pir', wallSlug: 'main' });
    expect((settings.get('mqtt') as { motionTopics: unknown[] }).motionTopics).toHaveLength(0);
    migrateMotionTopics(settings, log); // idempotent
    expect(settings.get('motionSources') as unknown[]).toHaveLength(1);
  });
});
