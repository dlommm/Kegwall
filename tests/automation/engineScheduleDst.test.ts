import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { StateManager } from '../../src/server/core/state.js';
import { AutomationEngine } from '../../src/server/automation/engine.js';
import { createAutomation } from '../../src/server/db/automations.js';
import type { AutomationRuleInput, Action, Trigger } from '../../src/server/core/automationSchema.js';

// ---------------------------------------------------------------------------
// DST boundary behavior for `schedule` triggers (server-hardening review, 2026-08-29).
// Matching is LOCAL wall-clock time (engine.ts `checkScheduleRules` doc comment): these
// tests pin the process timezone to America/New_York (Node honors a runtime
// `process.env.TZ` change on POSIX) and drive the engine's minute timer with fake
// timers across the 2026 transitions:
//   - 2026-03-08 spring forward (02:00 EST -> 03:00 EDT; 02:00-02:59 never exists)
//   - 2026-11-01 fall back      (02:00 EDT -> 01:00 EST; 01:00-01:59 happens twice)
// Same db/bus/engine harness as engine.test.ts's `schedule` describe block.
// ---------------------------------------------------------------------------

const REAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

let db: Database.Database;
let bus: EventBus;
let settings: SettingsStore;
let state: StateManager;
let engine: AutomationEngine | undefined;
let banners: unknown[];

function makeEngine(): AutomationEngine {
  engine = new AutomationEngine({
    db, bus, settings, state, presence: { setState: vi.fn() },
  });
  return engine;
}

function ruleFor(trigger: Trigger, actions: Action[]): AutomationRuleInput {
  return { name: 'DST Rule', trigger, actions, conditions: [] };
}

function bannerAction(): Action {
  return { type: 'wall_banner', text: 'banner', kind: 'info' };
}

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  settings = new SettingsStore(db);
  state = new StateManager(db, bus);
  state.start();
  banners = [];
  bus.on('wall_banner', (e) => banners.push(e));
  engine = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  engine?.stop();
  vi.useRealTimers();
});

describe('schedule triggers across DST transitions (America/New_York)', () => {
  it('sanity: the pinned timezone is in effect for local Date getters', () => {
    // 06:59 UTC on 2026-03-08 is 01:59 EST (UTC-5, pre-transition).
    expect(new Date('2026-03-08T06:59:00Z').getHours()).toBe(1);
    // 13:00 UTC that afternoon is 09:00 EDT (UTC-4, post-transition).
    expect(new Date('2026-03-08T13:00:00Z').getHours()).toBe(9);
  });

  it('spring forward: a rule inside the skipped 02:00-02:59 hour fires at the first tick after the gap, once', async () => {
    vi.setSystemTime(new Date('2026-03-08T06:59:30Z')); // 01:59:30 EST
    createAutomation(db, ruleFor({ type: 'schedule', time: '02:30', weekdays: [] }, [bannerAction()]));
    makeEngine().start();
    await engine!.flush();
    expect(banners).toHaveLength(0); // 01:59 — not yet

    // One 60s tick later the local clock reads 03:00:30 EDT — 02:30 never existed.
    await vi.advanceTimersByTimeAsync(60_000);
    await engine!.flush();
    expect(banners).toHaveLength(1); // caught up at the first post-gap tick

    await vi.advanceTimersByTimeAsync(60_000);
    await engine!.flush();
    expect(banners).toHaveLength(1); // and only once
  });

  it('spring forward: an afternoon rule fires at the LOCAL wall-clock time (new UTC offset), not an hour off', async () => {
    vi.setSystemTime(new Date('2026-03-08T12:59:30Z')); // 08:59:30 EDT
    createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [] }, [bannerAction()]));
    makeEngine().start();
    await engine!.flush();
    expect(banners).toHaveLength(0);

    // 13:00:30Z = 09:00:30 EDT. A fixed-EST-offset implementation would still be
    // waiting for 14:00Z here — firing an hour late on the wall.
    await vi.advanceTimersByTimeAsync(60_000);
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('fall back: a rule inside the repeated 01:00-01:59 hour fires once, not on both passes', async () => {
    vi.setSystemTime(new Date('2026-11-01T05:29:30Z')); // 01:29:30 EDT (first pass)
    createAutomation(db, ruleFor({ type: 'schedule', time: '01:30', weekdays: [] }, [bannerAction()]));
    makeEngine().start();
    await engine!.flush();
    expect(banners).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60_000); // 05:30:30Z = 01:30:30 EDT — first pass
    await engine!.flush();
    expect(banners).toHaveLength(1);

    // An hour of ticks later the wall clock reads 01:30 AGAIN (06:30:30Z = 01:30:30
    // EST) — the (day, time) fire key keeps it to the single fire.
    await vi.advanceTimersByTimeAsync(3_600_000);
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });
});
