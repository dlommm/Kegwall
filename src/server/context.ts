import type Database from 'better-sqlite3';
import { openDb } from './db/db.js';
import { EventBus } from './core/events.js';
import { SettingsStore } from './db/settings.js';

export interface AppContext {
  db: Database.Database;
  bus: EventBus;
  settings: SettingsStore;
}

export function createContext(dataDir: string): AppContext {
  const db = openDb(dataDir);
  return { db, bus: new EventBus(), settings: new SettingsStore(db) };
}
