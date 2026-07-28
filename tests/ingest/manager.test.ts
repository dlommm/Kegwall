import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/server/core/events.js';
import { SourceManager } from '../../src/server/ingest/manager.js';
import type { Source, SourceName } from '../../src/server/ingest/source.js';

function fakeSource(
  name: SourceName,
  opts: { throwOnStart?: boolean; throwOnStop?: boolean } = {},
): Source & { started: boolean; stopped: boolean } {
  const src = {
    name,
    started: false,
    stopped: false,
    async start() {
      if (opts.throwOnStart) throw new Error(`${name} boom`);
      src.started = true;
    },
    async stop() {
      if (opts.throwOnStop) throw new Error(`${name} stop boom`);
      src.stopped = true;
    },
  };
  return src;
}

describe('SourceManager', () => {
  it('isolates a throwing source.start() from other sources', async () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    const bad = fakeSource('kegtron_cloud', { throwOnStart: true });
    const good = fakeSource('kegtron_udp');
    manager.register(bad);
    manager.register(good);

    await expect(manager.startAll()).resolves.toBeUndefined();

    expect(good.started).toBe(true);
    const badStatus = manager.status().find((s) => s.name === 'kegtron_cloud')!;
    expect(badStatus.healthy).toBe(false);
    expect(badStatus.detail).toContain('boom');
  });

  it('never throws from stopAll even if a source throws on stop', async () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    const bad = fakeSource('gen1_mqtt', { throwOnStop: true });
    const good = fakeSource('gen1_ble');
    manager.register(bad);
    manager.register(good);

    await expect(manager.stopAll()).resolves.toBeUndefined();
    expect(good.stopped).toBe(true);
  });

  it('updates status() from source_status events', () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    const source = fakeSource('gen1_ble');
    manager.register(source);

    bus.emit('source_status', {
      source: 'gen1_ble', healthy: true, detail: 'connected', ts: '2026-07-27T00:00:00.000Z',
    });

    const status = manager.status().find((s) => s.name === 'gen1_ble')!;
    expect(status.registered).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.detail).toBe('connected');
    expect(status.lastEventAt).toBe('2026-07-27T00:00:00.000Z');
  });

  it('reports all known source names, marking unregistered ones registered:false', () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    const status = manager.status();
    expect(status).toHaveLength(5);
    expect(status.every((s) => s.registered === false)).toBe(true);
    expect(status.every((s) => s.healthy === false)).toBe(true);
    expect(status.every((s) => s.lastEventAt === null)).toBe(true);
    expect(status.map((s) => s.name).sort()).toEqual(
      ['gen1_ble', 'gen1_mqtt', 'kegtron_cloud', 'kegtron_udp', 'mqtt_publisher'],
    );
  });

  it('marks a source registered:true once registered, even before start', () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    manager.register(fakeSource('mqtt_publisher'));
    const status = manager.status().find((s) => s.name === 'mqtt_publisher')!;
    expect(status.registered).toBe(true);
  });

  it('reset() clears registrations so status() reports registered:false again', () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    manager.register(fakeSource('gen1_mqtt'));
    expect(manager.status().find((s) => s.name === 'gen1_mqtt')!.registered).toBe(true);

    manager.reset();

    expect(manager.status().find((s) => s.name === 'gen1_mqtt')!.registered).toBe(false);
  });

  it('isStarted() is false until startAll() has been called at least once', async () => {
    const bus = new EventBus();
    const manager = new SourceManager(bus);
    expect(manager.isStarted()).toBe(false);
    await manager.startAll();
    expect(manager.isStarted()).toBe(true);
  });
});
