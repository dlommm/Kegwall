import type Database from 'better-sqlite3';
import { openDb } from './db/db.js';
import { EventBus } from './core/events.js';
import { SettingsStore } from './db/settings.js';
import { StateManager } from './core/state.js';
import { SourceManager } from './ingest/manager.js';
import { registerConfiguredSources } from './ingest/bootstrap.js';
import { AutomationEngine } from './automation/engine.js';

export interface AppContext {
  db: Database.Database;
  bus: EventBus;
  settings: SettingsStore;
  state: StateManager;
  sources: SourceManager;
  engine: AutomationEngine;
}

export function createContext(dataDir: string): AppContext {
  const db = openDb(dataDir);
  const bus = new EventBus();
  const settings = new SettingsStore(db);
  const state = new StateManager(db, bus);
  state.start();
  const sources = new SourceManager(bus);
  // Constructed here (cheap: no I/O) but NOT started — `engine.start()` can dispatch
  // real actions (an `app_startup` rule's webhook/mqtt/SMTP/etc), so it's called
  // alongside `sources.startAll()` in `app.ts`, gated behind the same `startSources`
  // option, not unconditionally like `state.start()` above. See automation/engine.ts's
  // top doc comment, point 6.
  const engine = new AutomationEngine({ db, bus, settings, state });
  const ctx: AppContext = { db, bus, settings, state, sources, engine };
  // Registers whatever the current settings call for (Task 8's bootstrap.ts) — does NOT
  // start them; that's gated behind `buildApp()`'s `startSources` option (see app.ts /
  // index.ts) so tests never accidentally spin up real network/BLE/MQTT connections.
  registerConfiguredSources(ctx);
  return ctx;
}
