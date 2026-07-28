import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let store: SettingsStore;
beforeEach(() => {
  store = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
});

describe('SettingsStore', () => {
  it('returns defaults for unset keys', () => {
    expect(store.get('siteName')).toBe('My Taproom');
    expect(store.get('displayUnits')).toBe('us');
    expect(store.get('kegtronApiKey')).toBeNull();
  });

  it('round-trips values', () => {
    store.set('siteName', 'Keg Cave');
    store.set('kegtronApiKey', 'abc123secret');
    expect(store.get('siteName')).toBe('Keg Cave');
    expect(store.get('kegtronApiKey')).toBe('abc123secret');
  });

  it('masks secrets', () => {
    store.set('kegtronApiKey', 'abcdefghijklmnop');
    const m = store.masked();
    expect(m.kegtronApiKey).toBe('••••mnop');
    expect(m.siteName).toBe('My Taproom');
  });
});
