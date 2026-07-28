import type Database from 'better-sqlite3';
import { openDb } from './db/db.js';
import { EventBus } from './core/events.js';
import { SettingsStore } from './db/settings.js';
import { StateManager } from './core/state.js';
import { SourceManager } from './ingest/manager.js';
import { registerConfiguredSources } from './ingest/bootstrap.js';

export interface AppContext {
  db: Database.Database;
  bus: EventBus;
  settings: SettingsStore;
  state: StateManager;
  sources: SourceManager;
}

export function createContext(dataDir: string): AppContext {
  const db = openDb(dataDir);
  const bus = new EventBus();
  const state = new StateManager(db, bus);
  state.start();
  const sources = new SourceManager(bus);
  const ctx: AppContext = { db, bus, settings: new SettingsStore(db), state, sources };
  // Registers whatever the current settings call for (Task 8's bootstrap.ts) — does NOT
  // start them; that's gated behind `buildApp()`'s `startSources` option (see app.ts /
  // index.ts) so tests never accidentally spin up real network/BLE/MQTT connections.
  registerConfiguredSources(ctx);
  return ctx;
}
