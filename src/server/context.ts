import type Database from 'better-sqlite3';
import { openDb } from './db/db.js';
import { EventBus } from './core/events.js';
import { SettingsStore } from './db/settings.js';
import { StateManager } from './core/state.js';

export interface AppContext {
  db: Database.Database;
  bus: EventBus;
  settings: SettingsStore;
  state: StateManager;
}

export function createContext(dataDir: string): AppContext {
  const db = openDb(dataDir);
  const bus = new EventBus();
  const state = new StateManager(db, bus);
  state.start();
  return { db, bus, settings: new SettingsStore(db), state };
}
