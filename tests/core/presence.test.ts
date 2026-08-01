import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import { PresenceRegistry } from '../../src/server/core/presence.js';

const MIN = 60_000;
let bus: EventBus;
let reg: PresenceRegistry;
let powerEvents: EventMap['display_power_changed'][];
let motionEvents: EventMap['motion_detected'][];

beforeEach(() => {
  vi.useFakeTimers();
  bus = new EventBus();
  powerEvents = [];
  motionEvents = [];
  bus.on('display_power_changed', (e) => powerEvents.push(e));
  bus.on('motion_detected', (e) => motionEvents.push(e));
  reg = new PresenceRegistry(bus);
  reg.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 }]);
});
afterEach(() => { reg.stop(); vi.useRealTimers(); });

describe('PresenceRegistry', () => {
  it('starts active and walks active → screensaver → off on the configured timers', () => {
    expect(reg.stateOf('main')).toBe('active');
    vi.advanceTimersByTime(10 * MIN);
    expect(reg.stateOf('main')).toBe('screensaver');
    vi.advanceTimersByTime(50 * MIN); // 60 total from last activity
    expect(reg.stateOf('main')).toBe('off');
    expect(powerEvents.map((e) => e.state)).toEqual(['screensaver', 'off']);
    expect(powerEvents[0]).toMatchObject({ wallId: 1, wallSlug: 'main' });
  });

  it('motion during screensaver/off returns to active and restarts timers', () => {
    vi.advanceTimersByTime(10 * MIN);
    reg.motion('main', 'webhook');
    expect(reg.stateOf('main')).toBe('active');
    vi.advanceTimersByTime(9 * MIN);
    expect(reg.stateOf('main')).toBe('active'); // timer restarted, not resumed
    vi.advanceTimersByTime(1 * MIN);
    expect(reg.stateOf('main')).toBe('screensaver');
  });

  it('motion during active resets timers without emitting display_power_changed', () => {
    vi.advanceTimersByTime(9 * MIN);
    reg.motion('main', 'mqtt');
    vi.advanceTimersByTime(9 * MIN);
    expect(reg.stateOf('main')).toBe('active');
    expect(powerEvents).toHaveLength(0);
  });

  it('emits motion_detected at most once per 5s per zone', () => {
    reg.motion('main', 'mqtt');
    reg.motion('main', 'mqtt');
    vi.advanceTimersByTime(4_000);
    reg.motion('main', 'mqtt');
    expect(motionEvents).toHaveLength(1);
    vi.advanceTimersByTime(1_001);
    reg.motion('main', 'mqtt');
    expect(motionEvents).toHaveLength(2);
  });

  it('motion(null) wakes every zone', () => {
    reg.configure([
      { wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
      { wallId: 2, slug: 'patio', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
    ]);
    vi.advanceTimersByTime(10 * MIN);
    reg.motion(null, 'pour');
    expect(reg.stateOf('main')).toBe('active');
    expect(reg.stateOf('patio')).toBe('active');
  });

  it('motion(null) emits exactly ONE motion_detected event across multiple zones, not one per zone', () => {
    reg.configure([
      { wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
      { wallId: 2, slug: 'patio', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
      { wallId: 3, slug: 'garage', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
    ]);
    reg.motion(null, 'pour');
    expect(motionEvents).toHaveLength(1);
    expect(motionEvents[0]).toMatchObject({ wallSlug: null, source: 'pour' });
    // Still transitions every zone even though only one event fired.
    expect(reg.stateOf('main')).toBe('active');
    expect(reg.stateOf('patio')).toBe('active');
    expect(reg.stateOf('garage')).toBe('active');

    // Debounced the same as targeted wakes: a second global wake inside the 5s window
    // emits nothing more; one after the window emits exactly one more.
    reg.motion(null, 'pour');
    expect(motionEvents).toHaveLength(1);
    vi.advanceTimersByTime(5_001);
    reg.motion(null, 'pour');
    expect(motionEvents).toHaveLength(2);
  });

  it('targeted per-zone motion debounce is independent of the global debounce window', () => {
    reg.configure([
      { wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
      { wallId: 2, slug: 'patio', screensaverAfterMinutes: 10, offAfterMinutes: 60 },
    ]);
    // A global wake consumes the global debounce window but must not touch either
    // zone's own per-zone debounce window.
    reg.motion(null, 'pour');
    expect(motionEvents).toHaveLength(1);
    reg.motion('main', 'touch');
    expect(motionEvents).toHaveLength(2);
    expect(motionEvents[1]).toMatchObject({ wallSlug: 'main', source: 'touch' });
    reg.motion('patio', 'touch');
    expect(motionEvents).toHaveLength(3);
    expect(motionEvents[2]).toMatchObject({ wallSlug: 'patio', source: 'touch' });
  });

  it('screensaverAfterMinutes null goes straight to off at offAfterMinutes', () => {
    reg.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: null, offAfterMinutes: 30 }]);
    vi.advanceTimersByTime(30 * MIN);
    expect(reg.stateOf('main')).toBe('off');
    expect(powerEvents.map((e) => e.state)).toEqual(['off']);
  });

  it('both timers null never transitions', () => {
    reg.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: null, offAfterMinutes: null }]);
    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(reg.stateOf('main')).toBe('active');
  });

  it('setState overrides, clears timers, and is a no-op when already in that state', () => {
    reg.setState('main', 'off');
    expect(reg.stateOf('main')).toBe('off');
    expect(powerEvents.map((e) => e.state)).toEqual(['off']);
    reg.setState('main', 'off'); // no duplicate event (loop guard for the automation action)
    expect(powerEvents).toHaveLength(1);
    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(reg.stateOf('main')).toBe('off'); // stays until motion
    reg.motion('main', 'touch');
    expect(reg.stateOf('main')).toBe('active');
  });

  it('configure keeps surviving zones state and drops removed ones', () => {
    vi.advanceTimersByTime(10 * MIN);
    expect(reg.stateOf('main')).toBe('screensaver');
    reg.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 }]);
    expect(reg.stateOf('main')).toBe('screensaver');
    reg.configure([]);
    expect(reg.stateOf('main')).toBeUndefined();
  });

  it('screensaver zone re-arms off timer across configure', () => {
    vi.advanceTimersByTime(10 * MIN);
    expect(reg.stateOf('main')).toBe('screensaver');
    reg.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 }]);
    vi.advanceTimersByTime(50 * MIN);
    expect(reg.stateOf('main')).toBe('off');
  });

  it('off zone stays off across configure with no timer resurrection', () => {
    vi.advanceTimersByTime(60 * MIN);
    expect(reg.stateOf('main')).toBe('off');
    reg.configure([{ wallId: 1, slug: 'main', screensaverAfterMinutes: 10, offAfterMinutes: 60 }]);
    expect(reg.stateOf('main')).toBe('off');
    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(reg.stateOf('main')).toBe('off'); // stays off, no timer fires
  });
});
