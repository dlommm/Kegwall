import type Database from 'better-sqlite3';
import { z } from 'zod';
import { ValidationError } from '../core/errors.js';

export const settingsSchema = z.object({
  siteName: z.string().default('My Taproom'),
  siteLogo: z.string().nullable().default(null),
  displayUnits: z.enum(['us', 'metric']).default('us'),
  servingSizeMl: z.number().int().positive().default(473), // 16 oz
  kegtronApiKey: z.string().nullable().default(null),
  udpEnabled: z.boolean().default(false),
  bleDirectEnabled: z.boolean().default(false),
  mqtt: z
    .object({
      url: z.string(),            // e.g. mqtt://host:1883 or mqtts://
      username: z.string().optional(),
      password: z.string().optional(),
      gen1TopicPrefix: z.string().default('home/TheengsGateway'),
      haPublishEnabled: z.boolean().default(false),
      haDiscoveryPrefix: z.string().default('homeassistant'),
      appTopicPrefix: z.string().default('kegtron-dashboard'),
    })
    .nullable()
    .default(null),
  untappd: z
    .object({ clientId: z.string(), clientSecret: z.string() })
    .nullable()
    .default(null),
  quietHours: z
    .object({ start: z.string(), end: z.string() }) // "22:00" / "08:00"
    .nullable()
    .default(null),
});

export type Settings = z.infer<typeof settingsSchema>;

const SECRET_KEYS = ['kegtronApiKey'] as const;

const MASK_PREFIX = '••••';

function isMaskedString(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(MASK_PREFIX);
}

/**
 * GET /api/settings replaces secrets with a '••••'-prefixed display mask
 * (see `masked()` below). If a client round-trips that body back through
 * PATCH without editing the secret field, the mask string must never be
 * written as if it were the real secret — that would silently destroy the
 * stored value. This guards both the flat `kegtronApiKey` field and the
 * nested `mqtt.password` / `untappd.clientSecret` fields.
 */
function assertNoMaskedSecret<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if ((SECRET_KEYS as readonly string[]).includes(key as string) && isMaskedString(value)) {
    throw new ValidationError(`${key} looks like a masked display value; refusing to store it`);
  }
  if (key === 'mqtt' && value && typeof value === 'object' && isMaskedString((value as any).password)) {
    throw new ValidationError('mqtt.password looks like a masked display value; refusing to store it');
  }
  if (key === 'untappd' && value && typeof value === 'object' && isMaskedString((value as any).clientSecret)) {
    throw new ValidationError('untappd.clientSecret looks like a masked display value; refusing to store it');
  }
}

export class SettingsStore {
  constructor(private db: Database.Database) {}

  all(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string; value: string;
    }[];
    const raw: Record<string, unknown> = {};
    for (const r of rows) raw[r.key] = JSON.parse(r.value);
    return settingsSchema.parse(raw);
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.all()[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    assertNoMaskedSecret(key, value);
    settingsSchema.shape[key].parse(value);
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, JSON.stringify(value));
  }

  /**
   * Prepares a PATCH body for writing: a top-level secret whose value is
   * still in its masked display form is dropped from the patch entirely
   * (the real stored value is left untouched); a nested secret sub-field
   * (mqtt.password, untappd.clientSecret) that is still masked is replaced
   * with the currently-stored real value so the rest of that object's edits
   * (e.g. mqtt.url) still apply. Callers should pass the result to `set()`
   * key by key, as the PATCH route does.
   */
  sanitizePatch(patch: Partial<Settings>): Partial<Settings> {
    const out: Partial<Settings> = { ...patch };
    if (isMaskedString(out.kegtronApiKey)) {
      delete out.kegtronApiKey;
    }
    if (out.mqtt && isMaskedString(out.mqtt.password)) {
      out.mqtt = { ...out.mqtt, password: this.get('mqtt')?.password };
    }
    if (out.untappd && isMaskedString(out.untappd.clientSecret)) {
      // clientSecret is a required string in the schema; a masked value here
      // implies a real one must already exist (masked() only masks a truthy
      // secret), so the '' fallback is unreachable in practice — it exists
      // only to satisfy the type when the stored settings lack untappd.
      out.untappd = { ...out.untappd, clientSecret: this.get('untappd')?.clientSecret ?? '' };
    }
    return out;
  }

  /** Settings safe to send to the frontend: secrets replaced by last-4 masks. */
  masked(): Settings {
    const s = this.all();
    for (const k of SECRET_KEYS) {
      const v = s[k];
      if (typeof v === 'string' && v.length > 0) {
        (s as any)[k] = '••••' + v.slice(-4);
      }
    }
    if (s.mqtt?.password) s.mqtt.password = '••••';
    if (s.untappd?.clientSecret) s.untappd.clientSecret = '••••';
    return s;
  }
}
