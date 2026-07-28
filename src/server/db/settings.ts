import type Database from 'better-sqlite3';
import { z } from 'zod';

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
    settingsSchema.shape[key].parse(value);
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, JSON.stringify(value));
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
