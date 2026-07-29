import type Database from 'better-sqlite3';
import { openDb } from './db/db.js';
import { EventBus } from './core/events.js';
import { SettingsStore } from './db/settings.js';
import { StateManager } from './core/state.js';
import { TabletArmRegistry } from './core/tabletArm.js';
import { LogService } from './core/logService.js';
import { SourceManager } from './ingest/manager.js';
import { registerConfiguredSources } from './ingest/bootstrap.js';
import { AutomationEngine } from './automation/engine.js';
import { pruneNotifications } from './db/notificationsRepo.js';
import { pruneTelemetry } from './db/telemetry.js';
import { pruneLogs } from './db/logs.js';

export interface AppContext {
  db: Database.Database;
  bus: EventBus;
  settings: SettingsStore;
  state: StateManager;
  sources: SourceManager;
  engine: AutomationEngine;
  /** The kegerator tablet's armed-pourer slot (Pour Wall overhaul Phase 3). */
  tabletArm: TabletArmRegistry;
  /** The unified log stream's writer (Pour Wall overhaul Phase 4, design 5d). */
  log: LogService;
}

/**
 * Final-review fix wave (I2): `pruneNotifications` (plan-promised, >90d) and
 * `pruneTelemetry` (spec: "rows older than 90 days pruned at startup" -- pre-existing,
 * predates Phase 5) were both built and unit-tested but never actually CALLED from
 * anywhere -- no startup hook, no timer -- so both tables grew forever in a real
 * long-running install. Run once, right after `openDb()` (migrations already run inside
 * it), so this rides the exact same "every boot" path migrations do -- unconditional, NOT
 * gated behind `startSources` like `sources.startAll()`/`engine.start()`, since pruning is
 * a local DB maintenance operation with no network/side-effect risk for a test that merely
 * `buildApp()`s without opting into real sources. Cheap even on a huge table (single
 * indexed-range `DELETE ... WHERE ts < ?`, see each function's own doc comment) and a
 * no-op on a fresh install (0 rows old enough).
 */
function pruneStaleRows(db: Database.Database): void {
  const prunedNotifications = pruneNotifications(db);
  const prunedTelemetry = pruneTelemetry(db);
  if (prunedNotifications > 0 || prunedTelemetry > 0) {
    console.log(`[startup] pruned ${prunedNotifications} notification(s), ${prunedTelemetry} telemetry row(s) older than 90 days`);
  }
}

export function createContext(dataDir: string): AppContext {
  const db = openDb(dataDir);
  pruneStaleRows(db);
  const bus = new EventBus();
  const settings = new SettingsStore(db);
  const tabletArm = new TabletArmRegistry();
  const state = new StateManager(db, bus, tabletArm);
  state.start();
  const log = new LogService(db, bus);
  log.attach();
  pruneLogs(db, settings.get('logRetentionDays'));
  const sources = new SourceManager(bus);
  // Constructed here (cheap: no I/O) but NOT started — `engine.start()` can dispatch
  // real actions (an `app_startup` rule's webhook/mqtt/SMTP/etc), so it's called
  // alongside `sources.startAll()` in `app.ts`, gated behind the same `startSources`
  // option, not unconditionally like `state.start()` above. See automation/engine.ts's
  // top doc comment, point 6.
  const engine = new AutomationEngine({ db, bus, settings, state });
  const ctx: AppContext = { db, bus, settings, state, sources, engine, tabletArm, log };
  // Registers whatever the current settings call for (Task 8's bootstrap.ts) — does NOT
  // start them; that's gated behind `buildApp()`'s `startSources` option (see app.ts /
  // index.ts) so tests never accidentally spin up real network/BLE/MQTT connections.
  registerConfiguredSources(ctx);
  return ctx;
}
