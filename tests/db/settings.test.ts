import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { ValidationError } from '../../src/server/core/errors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let store: SettingsStore;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  store = new SettingsStore(db);
});

// mqtt has several zod-defaulted sub-fields that are required in the output
// (Settings) type SettingsStore.set() expects; fill them in for test payloads.
const MQTT_DEFAULTS = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haPublishEnabled: false,
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegwall',
  motionTopics: [],
};

describe('SettingsStore', () => {
  it('returns defaults for unset keys', () => {
    expect(store.get('siteName')).toBe('My Taproom');
    expect(store.get('displayUnits')).toBe('us');
    expect(store.get('kegtronApiKey')).toBeNull();
    expect(store.get('backfillCursors')).toEqual({});
  });

  // Final review C1: persisted per-device servings-backfill high-water mark
  // (deviceId -> last successful backfill end ISO ts) -- not a secret, so it round-trips
  // through set()/get() like any other plain field, with no masking involved.
  it('round-trips backfillCursors (deviceId -> ISO ts map, not a secret)', () => {
    store.set('backfillCursors', { device2: '2026-07-27 12:00:00' });
    expect(store.get('backfillCursors')).toEqual({ device2: '2026-07-27 12:00:00' });
    const m = store.masked();
    expect(m.backfillCursors).toEqual({ device2: '2026-07-27 12:00:00' });
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

  it('sanitizePatch drops a masked top-level secret and merges a masked nested secret', () => {
    store.set('kegtronApiKey', 'realsecretvalue1');
    store.set('mqtt', {
      ...MQTT_DEFAULTS, url: 'mqtt://host:1883', username: 'u', password: 'realmqttpass',
    });

    const patch = {
      kegtronApiKey: '••••ue16',
      mqtt: { ...MQTT_DEFAULTS, url: 'mqtt://newhost:1883', username: 'u2', password: '••••' },
    };
    const sanitized = store.sanitizePatch(patch);

    expect(sanitized.kegtronApiKey).toBeUndefined();
    expect(sanitized.mqtt).toMatchObject({ url: 'mqtt://newhost:1883', username: 'u2' });
    expect(sanitized.mqtt?.password).toBe('realmqttpass');
  });

  // Post-Untappd-removal regression: an install upgraded from a version that still had
  // the `untappd` settings key would have a stale `untappd` row sitting in the `settings`
  // table (SettingsStore never deletes a row just because a later schema drops the key).
  // zod's default `z.object()` behavior is to silently STRIP unrecognized keys on parse
  // (not throw — verified directly against this repo's zod version), so `all()`/`get()`
  // must keep working unmodified against that leftover row; this inserts one directly
  // (bypassing `set()`, which no longer accepts an `untappd` key at the type level at
  // all) to prove it.
  it('tolerates a stale, no-longer-in-schema settings row (e.g. a pre-removal "untappd" row) without throwing', () => {
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run('untappd', JSON.stringify({ clientId: 'stale-id', clientSecret: 'stale-secret' }));
    store.set('siteName', 'Still Works');

    expect(() => store.all()).not.toThrow();
    const all = store.all();
    expect(all.siteName).toBe('Still Works');
    expect((all as Record<string, unknown>).untappd).toBeUndefined();
    expect(() => store.masked()).not.toThrow();
    expect(store.get('siteName')).toBe('Still Works');
  });

  // Presence spec Part A2/A3 (task-5 review F1): `presenceWebhookToken` is a top-level
  // nullable string secret with the exact same shape as `kegtronApiKey`, so it follows
  // that same idiom -- masked to a last-4 suffix, `set()` refuses a masked value verbatim,
  // `sanitizePatch()` drops (not merges) a masked value from the patch.
  describe('presenceWebhookToken', () => {
    it('masks to a last-4 suffix, like kegtronApiKey', () => {
      store.set('presenceWebhookToken', 'abcdefghijklmnop');
      const m = store.masked();
      expect(m.presenceWebhookToken).toBe('••••mnop');
    });

    it('set() throws ValidationError when given a masked presenceWebhookToken', () => {
      store.set('presenceWebhookToken', 'realwebhooktoken1');
      expect(() => store.set('presenceWebhookToken', '••••ken1')).toThrow(ValidationError);
      // the real value must be untouched
      expect(store.get('presenceWebhookToken')).toBe('realwebhooktoken1');
    });

    it('sanitizePatch drops a masked presenceWebhookToken from the patch', () => {
      store.set('presenceWebhookToken', 'realwebhooktoken1');
      const sanitized = store.sanitizePatch({ presenceWebhookToken: '••••ken1' });
      expect(sanitized.presenceWebhookToken).toBeUndefined();
      // dropped, not merged -- the caller's set()-per-key loop then leaves the
      // currently-stored real value alone since the key is simply absent from the patch
      expect(store.get('presenceWebhookToken')).toBe('realwebhooktoken1');
    });
  });

  // catalog.beer beer search (replaces the removed Untappd search): `catalogBeer` is a
  // nested, independently-nullable object (like `mqtt`) with a single secret sub-field,
  // `apiKey` -- same "secret nested inside a nested object" shape as `mqtt.password`,
  // masked to a last-4 suffix (like `kegtronApiKey`/`alertChannels.pushover.token`) rather
  // than a bare '••••' (like `mqtt.password`) since an API key, unlike a password, is
  // safe and useful to partially reveal for at-a-glance recognition.
  describe('catalogBeer', () => {
    it('defaults to null (not configured)', () => {
      expect(store.get('catalogBeer')).toBeNull();
    });

    it('round-trips a real apiKey', () => {
      store.set('catalogBeer', { apiKey: 'cb-real-secret-key' });
      expect(store.get('catalogBeer')).toEqual({ apiKey: 'cb-real-secret-key' });
    });

    it('masks apiKey to a last-4 suffix', () => {
      store.set('catalogBeer', { apiKey: 'cb-real-secret-key' });
      const m = store.masked();
      expect(m.catalogBeer?.apiKey).toBe('••••-key');
    });

    it('set() throws ValidationError when given a masked catalogBeer.apiKey', () => {
      store.set('catalogBeer', { apiKey: 'cb-real-secret-key' });
      expect(() => store.set('catalogBeer', { apiKey: '••••-key' })).toThrow(ValidationError);
      expect(store.get('catalogBeer')?.apiKey).toBe('cb-real-secret-key');
    });

    it('sanitizePatch merges a masked catalogBeer.apiKey back to the currently-stored real value', () => {
      store.set('catalogBeer', { apiKey: 'cb-real-secret-key' });
      const sanitized = store.sanitizePatch({ catalogBeer: { apiKey: '••••-key' } });
      expect(sanitized.catalogBeer?.apiKey).toBe('cb-real-secret-key');
    });

    it('sanitizePatch leaves a freshly typed (unmasked) catalogBeer.apiKey alone', () => {
      store.set('catalogBeer', { apiKey: 'cb-real-secret-key' });
      const sanitized = store.sanitizePatch({ catalogBeer: { apiKey: 'brand-new-key' } });
      expect(sanitized.catalogBeer?.apiKey).toBe('brand-new-key');
    });

    it('exposes a hidden catalogBeerBaseUrl setting with its real default', () => {
      expect(store.get('catalogBeerBaseUrl')).toBe('https://catalog.beer');
    });
  });

  // Phase 5 Task 2: alertChannels config (ntfy/pushover/smtp/discord/slack), each
  // optional/nullable. Secrets: pushover.token, smtp.password, discord.webhookUrl,
  // slack.webhookUrl (masked to origin + '/…' so an admin can still recognize which
  // webhook is configured) -- same set()/sanitizePatch()/masked() precedent as
  // kegtronApiKey/mqtt.password/untappd.clientSecret above.
  describe('alertChannels', () => {
    it('defaults to an empty object', () => {
      expect(store.get('alertChannels')).toEqual({});
    });

    it('round-trips a full alertChannels config', () => {
      const cfg = {
        ntfy: { serverUrl: 'https://ntfy.sh', topic: 'taproom-alerts' },
        pushover: { token: 'app-token-123456', user: 'user-key-123456' },
        smtp: {
          host: 'smtp.example.com', port: 587, secure: false,
          user: 'smtp-user', password: 'smtp-pass-123456',
          from: 'kegtron@example.com', to: 'admin@example.com',
        },
        discord: { webhookUrl: 'https://discord.com/api/webhooks/123/abcSecretToken' },
        slack: { webhookUrl: 'https://hooks.slack.com/services/T00/B00/abcSecretToken' },
      };
      store.set('alertChannels', cfg);
      expect(store.get('alertChannels')).toEqual(cfg);
    });

    it('allows each channel independently, omitting the rest', () => {
      store.set('alertChannels', { ntfy: { serverUrl: 'https://ntfy.sh', topic: 'x' } });
      const stored = store.get('alertChannels');
      expect(stored.ntfy).toEqual({ serverUrl: 'https://ntfy.sh', topic: 'x' });
      expect(stored.pushover).toBeUndefined();
    });

    it('allows explicitly clearing a channel with null', () => {
      store.set('alertChannels', { discord: { webhookUrl: 'https://discord.com/api/webhooks/1/tok' } });
      store.set('alertChannels', { discord: null });
      expect(store.get('alertChannels').discord).toBeNull();
    });

    it('masks pushover.token to a last-4 suffix, like kegtronApiKey', () => {
      store.set('alertChannels', { pushover: { token: 'app-token-abcdwxyz', user: 'user-key-1' } });
      const m = store.masked();
      expect(m.alertChannels.pushover?.token).toBe('••••wxyz');
      expect(m.alertChannels.pushover?.user).toBe('user-key-1'); // not a secret
    });

    it('masks smtp.password to a bare "••••", like mqtt.password', () => {
      store.set('alertChannels', {
        smtp: {
          host: 'smtp.example.com', port: 587, secure: false, password: 'smtp-secret',
          from: 'a@example.com', to: 'b@example.com',
        },
      });
      const m = store.masked();
      expect(m.alertChannels.smtp?.password).toBe('••••');
      expect(m.alertChannels.smtp?.host).toBe('smtp.example.com'); // not a secret
    });

    it('masks discord.webhookUrl to origin + "/…"', () => {
      store.set('alertChannels', { discord: { webhookUrl: 'https://discord.com/api/webhooks/123/secretTokenHere' } });
      const m = store.masked();
      expect(m.alertChannels.discord?.webhookUrl).toBe('https://discord.com/…');
    });

    it('masks slack.webhookUrl to origin + "/…"', () => {
      store.set('alertChannels', { slack: { webhookUrl: 'https://hooks.slack.com/services/T00/B00/secretTokenHere' } });
      const m = store.masked();
      expect(m.alertChannels.slack?.webhookUrl).toBe('https://hooks.slack.com/…');
    });

    it('set() throws ValidationError when given a masked pushover.token', () => {
      store.set('alertChannels', { pushover: { token: 'realtoken12345678', user: 'u' } });
      expect(() =>
        store.set('alertChannels', { pushover: { token: '••••5678', user: 'u' } }),
      ).toThrow(ValidationError);
      expect(store.get('alertChannels').pushover?.token).toBe('realtoken12345678');
    });

    it('set() throws ValidationError when given a masked smtp.password', () => {
      store.set('alertChannels', {
        smtp: { host: 'h', port: 587, secure: false, password: 'realsmtppass', from: 'a@x.com', to: 'b@x.com' },
      });
      expect(() =>
        store.set('alertChannels', {
          smtp: { host: 'h', port: 587, secure: false, password: '••••', from: 'a@x.com', to: 'b@x.com' },
        }),
      ).toThrow(ValidationError);
      expect(store.get('alertChannels').smtp?.password).toBe('realsmtppass');
    });

    it('set() throws ValidationError when given a masked discord.webhookUrl', () => {
      store.set('alertChannels', { discord: { webhookUrl: 'https://discord.com/api/webhooks/1/realtoken' } });
      expect(() =>
        store.set('alertChannels', { discord: { webhookUrl: 'https://discord.com/…' } }),
      ).toThrow(ValidationError);
      expect(store.get('alertChannels').discord?.webhookUrl).toBe('https://discord.com/api/webhooks/1/realtoken');
    });

    it('set() throws ValidationError when given a masked slack.webhookUrl', () => {
      store.set('alertChannels', { slack: { webhookUrl: 'https://hooks.slack.com/services/1/realtoken' } });
      expect(() =>
        store.set('alertChannels', { slack: { webhookUrl: 'https://hooks.slack.com/…' } }),
      ).toThrow(ValidationError);
      expect(store.get('alertChannels').slack?.webhookUrl).toBe('https://hooks.slack.com/services/1/realtoken');
    });

    it('sanitizePatch merges masked secrets back in, independently per channel', () => {
      store.set('alertChannels', {
        pushover: { token: 'realtoken12345678', user: 'user-old' },
        smtp: { host: 'h', port: 587, secure: false, password: 'realsmtppass', from: 'a@x.com', to: 'b@x.com' },
        discord: { webhookUrl: 'https://discord.com/api/webhooks/1/realtoken' },
        slack: { webhookUrl: 'https://hooks.slack.com/services/1/realtoken' },
      });

      const patch = {
        alertChannels: {
          pushover: { token: '••••5678', user: 'user-new' }, // user edited, token untouched (still masked)
          smtp: { host: 'h2', port: 587, secure: false, password: '••••', from: 'a@x.com', to: 'b@x.com' },
          discord: { webhookUrl: 'https://discord.com/…' },
          slack: { webhookUrl: 'https://hooks.slack.com/…' },
        },
      };
      const sanitized = store.sanitizePatch(patch);

      expect(sanitized.alertChannels?.pushover).toEqual({ token: 'realtoken12345678', user: 'user-new' });
      expect(sanitized.alertChannels?.smtp?.password).toBe('realsmtppass');
      expect(sanitized.alertChannels?.smtp?.host).toBe('h2');
      expect(sanitized.alertChannels?.discord?.webhookUrl).toBe('https://discord.com/api/webhooks/1/realtoken');
      expect(sanitized.alertChannels?.slack?.webhookUrl).toBe('https://hooks.slack.com/services/1/realtoken');
    });

    it('sanitizePatch leaves an explicitly-nulled channel alone (not "masked")', () => {
      store.set('alertChannels', { discord: { webhookUrl: 'https://discord.com/api/webhooks/1/realtoken' } });
      const sanitized = store.sanitizePatch({ alertChannels: { discord: null } });
      expect(sanitized.alertChannels?.discord).toBeNull();
    });
  });

  describe('updates.watchtowerToken (System card secret)', () => {
    it('masked() shows last-4; a mode/url edit round-tripping the masked token keeps the stored real one', () => {
      store.set('updates', {
        mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:8090', watchtowerToken: 'supersecret-abcd',
      });
      expect(store.masked().updates?.watchtowerToken).toBe('••••abcd');

      const sanitized = store.sanitizePatch({
        updates: { mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:9999', watchtowerToken: '••••abcd' },
      });
      expect(sanitized.updates?.watchtowerToken).toBe('supersecret-abcd');
      expect(sanitized.updates?.watchtowerUrl).toBe('http://127.0.0.1:9999');
    });

    it('set() refuses to store a masked token verbatim', () => {
      expect(() => store.set('updates', {
        mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:8090', watchtowerToken: '••••abcd',
      })).toThrow(/masked/);
    });
  });

  describe('faceSignIn', () => {
    it('faceSignIn defaults disabled with 0.6 threshold', () => {
      expect(store.get('faceSignIn')).toEqual({ enabled: false, threshold: 0.6 });
    });

    it('faceSignIn round-trips and validates threshold bounds', () => {
      store.set('faceSignIn', { enabled: true, threshold: 0.75 });
      expect(store.get('faceSignIn')).toEqual({ enabled: true, threshold: 0.75 });
      expect(() => store.set('faceSignIn', { enabled: true, threshold: 0.1 } as never)).toThrow();
    });
  });
});
