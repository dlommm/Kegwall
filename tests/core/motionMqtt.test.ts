import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import { PresenceRegistry } from '../../src/server/core/presence.js';
import { MotionMqttSource, isMotionPayload } from '../../src/server/ingest/motionMqtt.js';

describe('isMotionPayload', () => {
  it.each(['', 'off', 'OFF', '0', 'false', 'closed'])('%j is not motion', (p) => {
    expect(isMotionPayload(p)).toBe(false);
  });
  it.each(['ON', '1', 'true', '{"occupancy":true}'])('%j is motion', (p) => {
    expect(isMotionPayload(p)).toBe(true);
  });
});

describe('MotionMqttSource', () => {
  let bus: EventBus;
  let presence: PresenceRegistry;
  let fakeClient: EventEmitter & { subscribe: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  let source: MotionMqttSource;
  let statuses: EventMap['source_status'][];

  beforeEach(async () => {
    bus = new EventBus();
    statuses = [];
    bus.on('source_status', (e) => statuses.push(e));
    presence = new PresenceRegistry(bus);
    presence.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: null, offAfterMinutes: null }]);
    fakeClient = Object.assign(new EventEmitter(), { subscribe: vi.fn(), end: vi.fn() });
    source = new MotionMqttSource({
      url: 'mqtt://test', topics: [{ topic: 'home/pir', wallSlug: 'main' }],
      presence, bus, connectFn: (() => fakeClient) as never,
    });
    await source.start();
  });

  it('subscribes each configured topic and reports healthy on connect', () => {
    fakeClient.emit('connect');
    expect(fakeClient.subscribe).toHaveBeenCalledWith('home/pir');
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_mqtt', healthy: true });
  });

  it('feeds motion payloads to the registry and ignores off payloads', () => {
    const spy = vi.spyOn(presence, 'motion');
    fakeClient.emit('message', 'home/pir', Buffer.from('ON'));
    expect(spy).toHaveBeenCalledWith('main', 'mqtt');
    spy.mockClear();
    fakeClient.emit('message', 'home/pir', Buffer.from('OFF'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports unhealthy on close', () => {
    fakeClient.emit('close');
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_mqtt', healthy: false });
  });
});
