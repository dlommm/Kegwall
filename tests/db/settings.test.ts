import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { ValidationError } from '../../src/server/core/errors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let store: SettingsStore;
beforeEach(() => {
  store = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
});

// mqtt has several zod-defaulted sub-fields that are required in the output
// (Settings) type SettingsStore.set() expects; fill them in for test payloads.
const MQTT_DEFAULTS = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haPublishEnabled: false,
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegtron-dashboard',
};

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

  it('set() throws ValidationError when given a masked kegtronApiKey', () => {
    store.set('kegtronApiKey', 'realsecretvalue1');
    expect(() => store.set('kegtronApiKey', '••••ue16')).toThrow(ValidationError);
    // the real value must be untouched
    expect(store.get('kegtronApiKey')).toBe('realsecretvalue1');
  });

  it('set() throws ValidationError when given a masked mqtt.password', () => {
    store.set('mqtt', { ...MQTT_DEFAULTS, url: 'mqtt://host:1883', password: 'realmqttpass' });
    expect(() =>
      store.set('mqtt', { ...MQTT_DEFAULTS, url: 'mqtt://host:1883', password: '••••' }),
    ).toThrow(ValidationError);
    expect(store.get('mqtt')?.password).toBe('realmqttpass');
  });

  it('set() throws ValidationError when given a masked untappd.clientSecret', () => {
    store.set('untappd', { clientId: 'id1', clientSecret: 'realclientsecret' });
    expect(() => store.set('untappd', { clientId: 'id1', clientSecret: '••••' }))
      .toThrow(ValidationError);
    expect(store.get('untappd')?.clientSecret).toBe('realclientsecret');
  });

  it('sanitizePatch drops a masked top-level secret and merges masked nested secrets', () => {
    store.set('kegtronApiKey', 'realsecretvalue1');
    store.set('mqtt', {
      ...MQTT_DEFAULTS, url: 'mqtt://host:1883', username: 'u', password: 'realmqttpass',
    });
    store.set('untappd', { clientId: 'id1', clientSecret: 'realclientsecret' });

    const patch = {
      kegtronApiKey: '••••ue16',
      mqtt: { ...MQTT_DEFAULTS, url: 'mqtt://newhost:1883', username: 'u2', password: '••••' },
      untappd: { clientId: 'id2', clientSecret: '••••' },
    };
    const sanitized = store.sanitizePatch(patch);

    expect(sanitized.kegtronApiKey).toBeUndefined();
    expect(sanitized.mqtt).toMatchObject({ url: 'mqtt://newhost:1883', username: 'u2' });
    expect(sanitized.mqtt?.password).toBe('realmqttpass');
    expect(sanitized.untappd).toMatchObject({ clientId: 'id2' });
    expect(sanitized.untappd?.clientSecret).toBe('realclientsecret');
  });
});
