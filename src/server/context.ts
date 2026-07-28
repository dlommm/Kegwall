import type Database from 'better-sqlite3';
import { openDb } from './db/db.js';
import { EventBus } from './core/events.js';
import { SettingsStore } from './db/settings.js';
import { StateManager } from './core/state.js';
import { SourceManager } from './ingest/manager.js';

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
  return { db, bus, settings: new SettingsStore(db), state, sources };
}
