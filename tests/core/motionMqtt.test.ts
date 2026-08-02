import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import type { MotionSourceRegistry } from '../../src/server/core/motionSources.js';
import { MotionMqttSource, isMotionPayload, matchesRule } from '../../src/server/ingest/motionMqtt.js';

describe('isMotionPayload', () => {
  it.each(['', 'off', 'OFF', '0', 'false', 'closed'])('%j is not motion', (p) => {
    expect(isMotionPayload(p)).toBe(false);
  });
  it.each(['ON', '1', 'true', '{"occupancy":true}'])('%j is motion', (p) => {
    expect(isMotionPayload(p)).toBe(true);
  });
});

describe('matchesRule', () => {
  it.each([['ON', true], ['OFF', false], ['1', true], ['', false]])(
    'any mode: %j → %s', (p, want) => {
      expect(matchesRule(p as string, { mode: 'any' })).toBe(want);
    });

  it('json mode: occupancy false must NOT match — the zigbee2mqtt bug', () => {
    const rule = { mode: 'json' as const, field: 'occupancy', equals: true };
    expect(matchesRule('{"occupancy":true}', rule)).toBe(true);
    expect(matchesRule('{"occupancy":false}', rule)).toBe(false);
    expect(matchesRule('not json', rule)).toBe(false);
    expect(matchesRule('{"other":true}', rule)).toBe(false);
    expect(matchesRule('{"occupancy":"true"}', rule)).toBe(false); // strict ===
  });

  it('exact mode is strict string equality', () => {
    expect(matchesRule('motion', { mode: 'exact', value: 'motion' })).toBe(true);
    expect(matchesRule(' motion', { mode: 'exact', value: 'motion' })).toBe(false);
  });
});

describe('MotionMqttSource', () => {
  let bus: EventBus;
  let registry: { trigger: ReturnType<typeof vi.fn>; markHealth: ReturnType<typeof vi.fn> };
  let fakeClient: EventEmitter & { subscribe: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  let source: MotionMqttSource;
  let statuses: EventMap['source_status'][];

  beforeEach(async () => {
    bus = new EventBus();
    statuses = [];
    bus.on('source_status', (e) => statuses.push(e));
    // A lean fake registry (spies only, no real DB/settings/PresenceRegistry plumbing)
    // -- the source's own responsibility under test is "call trigger/markHealth
    // correctly", not the registry's downstream wake behavior (see
    // tests/core/motionSources.test.ts for that).
    registry = { trigger: vi.fn(), markHealth: vi.fn() };
    fakeClient = Object.assign(new EventEmitter(), { subscribe: vi.fn(), end: vi.fn() });
    source = new MotionMqttSource({
      url: 'mqtt://test',
      sources: [{ id: 'pir-1', topic: 'home/pir', match: { mode: 'any' } }],
      registry: registry as unknown as MotionSourceRegistry,
      bus, connectFn: (() => fakeClient) as never,
    });
    await source.start();
  });

  it('subscribes each configured topic and reports healthy on connect, mirrored per source', () => {
    fakeClient.emit('connect');
    expect(fakeClient.subscribe).toHaveBeenCalledWith('home/pir');
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_mqtt', healthy: true });
    expect(registry.markHealth).toHaveBeenCalledWith('pir-1', true, expect.any(String));
  });

  it('triggers the source id in the registry for a matching payload on a subscribed topic', () => {
    fakeClient.emit('message', 'home/pir', Buffer.from('ON'));
    expect(registry.trigger).toHaveBeenCalledWith('pir-1');
  });

  it('does not trigger for a non-matching payload', () => {
    fakeClient.emit('message', 'home/pir', Buffer.from('OFF'));
    expect(registry.trigger).not.toHaveBeenCalled();
  });

  it('ignores a message on a topic this instance never subscribed to', () => {
    fakeClient.emit('message', 'some/other/topic', Buffer.from('ON'));
    expect(registry.trigger).not.toHaveBeenCalled();
  });

  it('reports unhealthy on close, mirrored per source via registry.markHealth', () => {
    fakeClient.emit('close');
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_mqtt', healthy: false });
    expect(registry.markHealth).toHaveBeenCalledWith('pir-1', false, 'connection closed');
  });
});

describe('MotionMqttSource with a json-mode match rule', () => {
  it('rejects the zigbee2mqtt occupancy:false payload end-to-end and triggers on occupancy:true', async () => {
    const bus = new EventBus();
    const registry = { trigger: vi.fn(), markHealth: vi.fn() };
    const fakeClient = Object.assign(new EventEmitter(), { subscribe: vi.fn(), end: vi.fn() });
    const source = new MotionMqttSource({
      url: 'mqtt://test',
      sources: [{
        id: 'zb-1', topic: 'zigbee2mqtt/hallway',
        match: { mode: 'json', field: 'occupancy', equals: true },
      }],
      registry: registry as unknown as MotionSourceRegistry,
      bus, connectFn: (() => fakeClient) as never,
    });
    await source.start();

    fakeClient.emit('message', 'zigbee2mqtt/hallway', Buffer.from('{"occupancy":false}'));
    expect(registry.trigger).not.toHaveBeenCalled();

    fakeClient.emit('message', 'zigbee2mqtt/hallway', Buffer.from('{"occupancy":true}'));
    expect(registry.trigger).toHaveBeenCalledWith('zb-1');
  });
});
