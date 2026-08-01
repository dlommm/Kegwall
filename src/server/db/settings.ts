import type Database from 'better-sqlite3';
import { z } from 'zod';
import { ValidationError } from '../core/errors.js';

export const settingsSchema = z.object({
  siteName: z.string().default('My Taproom'),
  siteLogo: z.string().nullable().default(null),
  displayUnits: z.enum(['us', 'metric']).default('us'),
  servingSizeMl: z.number().int().positive().default(473), // 16 oz
  // Unified log stream retention (design 5d footer: "Retention: 30 days,
  // configurable") — rows older than this are pruned at boot (see context.ts).
  logRetentionDays: z.number().int().min(1).max(365).default(30),
  kegtronApiKey: z.string().nullable().default(null),
  // Hidden (not surfaced in any admin UI form — there is no dynamic settings-schema
  // renderer in this app to begin with) mdash.net REST base URL override. Exists purely
  // for test injectability (Task 9: routes/kegtron.ts's MdashClient, same pattern as
  // MdashClient's own constructor-level `baseUrl` option / KegtronCloudSource's) so
  // integration tests can point the import/reset-volume routes at a fake local server
  // instead of the real mdash.net. Production behavior is unaffected by its presence:
  // the default reproduces MdashClient's own DEFAULT_BASE_URL exactly, and nothing else
  // reads this key (KegtronCloudSource is wired with no baseUrl override in bootstrap.ts
  // and so always uses that same default too).
  kegtronBaseUrl: z.string().default('https://mdash.net'),
  // Same hidden, test-injectable pattern as `kegtronBaseUrl` above — Task 4's
  // routes/lookup.ts proxies Open Brewery DB from a real production default here, but
  // tests point this at a local fake server instead. Not a secret (no credential lives in
  // the URL) and not surfaced in any settings form.
  openBreweryBaseUrl: z.string().default('https://api.openbrewerydb.org'),
  // Same hidden, test-injectable pattern as the one above — the CDN host
  // `decodeUntappdLabelUrl` (ingest/kegtron/shadow.ts) reconstructs a Kegtron Pro import's
  // label image URL against (Phase 5 Task 0's labelUrl-decode spec-parity item; a Kegtron
  // Pro device-spec detail, unrelated to the removed Untappd search integration below).
  // Not a secret; no admin UI form.
  untappdImageBaseUrl: z.string().default('https://untappd.akamaized.net'),
  // catalog.beer beer search (replaces the removed Untappd search) — a nested,
  // independently-nullable object (same shape as `mqtt` above) with a single secret
  // sub-field, `apiKey`. Masked to a last-4 suffix (like `kegtronApiKey`/
  // `alertChannels.pushover.token`), not a bare '••••' (like `mqtt.password`) — an API
  // key, unlike a password, is safe and useful to partially reveal. See
  // `assertNoMaskedSecret`/`sanitizePatch`/`masked()` below for how it's guarded.
  catalogBeer: z.object({ apiKey: z.string().min(1) }).nullable().default(null),
  // Same hidden, test-injectable pattern as `openBreweryBaseUrl`/`kegtronBaseUrl` above —
  // `routes/lookup.ts`'s beer-search proxy hits this in production; tests point it at a
  // local fake server instead. Not a secret (no credential lives in the URL) and not
  // surfaced in any settings form.
  catalogBeerBaseUrl: z.string().default('https://catalog.beer'),
  // Pour Wall overhaul Phase 6 (design 6g): auto-cache beers the Kegtron device
  // reports that the local library doesn't know — see core/beerAutoImport.ts.
  autoImportBeers: z.boolean().default(true),
  // Govee ambient sensors (Phase 6): cloud API key. Same nullable-object +
  // masked-apiKey idiom as `catalogBeer` above. Per-sensor names/enable now live on
  // the sensors' `monitors` rows (admin Monitors page); the old `names` map is
  // silently stripped from stored JSON by zod's default unknown-key handling.
  govee: z.object({
    apiKey: z.string().min(1),
  }).nullable().default(null),
  // Hidden, test-injectable base URL — same pattern as catalogBeerBaseUrl.
  goveeBaseUrl: z.string().default('https://openapi.api.govee.com'),
  // Hidden, test-injectable update-check source (routes/system.ts): the GitLab
  // instance + project whose Releases feed defines "latest version".
  updateCheckBaseUrl: z.string().default('https://github.com'),
  updateCheckProjectPath: z.string().default('dlomm/kegwall'),
  // In-app update trigger (Settings → System). `watchtower` posts to a Watchtower
  // sidecar's HTTP API (Docker installs); `native` writes a trigger file that the Pi
  // installer's systemd path unit picks up (bare-metal installs). The token is a
  // masked secret (all four masking pieces below).
  updates: z.object({
    mode: z.enum(['off', 'watchtower', 'native']),
    watchtowerUrl: z.string().url().optional(),
    watchtowerToken: z.string().min(1).optional(),
  }).nullable().default(null),
  // OS (apt) updates — native Pi installs only (the UI hides this unless
  // updates.mode is 'native'). `manual` arms the "Update OS now" button; `auto`
  // additionally relies on unattended-upgrades provisioned by pi-install.sh.
  // autoReboot travels as the trigger file's CONTENT ('run-reboot' vs 'run',
  // routes/system.ts) because the root-side updater script can't read app
  // settings. No secrets here — the masking machinery below does not apply.
  osUpdates: z.object({
    mode: z.enum(['off', 'manual', 'auto']),
    autoReboot: z.boolean().default(false),
  }).nullable().default(null),
  // Persisted per-device servings-backfill high-water mark: mdash device id ->
  // ISO-ish UTC "end" timestamp of the last successful backfill for that device (see
  // cloudSource.ts's `runBackfill`). NOT a secret — plain bookkeeping, no masking.
  // Final review C1 fix: `backfillDone` on KegtronCloudSource's per-device state was
  // in-memory only, so every process restart AND every source-relevant settings PATCH
  // (which tears down and rebuilds every source, see bootstrap.ts) re-ran the full
  // 7-day servings backfill from scratch, re-emitting (and re-recording, since the
  // in-memory PourDeduper is also reset by a restart) up to 7 days of ALREADY-imported
  // pours every time. This cursor lets a fresh backfill start from wherever the last
  // one left off instead of always re-requesting the full 7-day window.
  backfillCursors: z.record(z.string(), z.string()).default({}),
  udpEnabled: z.boolean().default(false),
  bleDirectEnabled: z.boolean().default(false),
  // Kegtron Pro BLE advert listener (ingest/kegtron/proBleSource.ts) — the pour
  // FALLBACK when UDP can't cross VLANs. End-of-pour only (see
  // docs/kegtron/pro-ble-format.md); live pours stay UDP.
  proBleEnabled: z.boolean().default(false),
  mqtt: z
    .object({
      url: z.string(),            // e.g. mqtt://host:1883 or mqtts://
      username: z.string().optional(),
      password: z.string().optional(),
      gen1TopicPrefix: z.string().default('home/TheengsGateway'),
      haPublishEnabled: z.boolean().default(false),
      haDiscoveryPrefix: z.string().default('homeassistant'),
      appTopicPrefix: z.string().default('kegwall'),
    })
    .nullable()
    .default(null),
  quietHours: z
    .object({ start: z.string(), end: z.string() }) // "22:00" / "08:00"
    .nullable()
    .default(null),
  // Presence spec Part A2/A3: shared secret for POST /api/presence/motion and
  // GET /api/presence/stream; generated client-side in admin Settings → Integrations;
  // null = those endpoints 503.
  presenceWebhookToken: z.string().nullable().default(null),
  // Phase 5 Task 2: per-channel config for the automation engine's notify action
  // (`notify/channels/*.ts`). Each channel is independently optional (a site might only
  // configure ntfy, or nothing at all) AND independently nullable (explicit `null` clears
  // a previously-configured channel, same "explicit null clears, omitted key preserves"
  // idiom as `taps.defaultDrinkerId` / `automations.ts`'s `alertConfig`). Secrets:
  // `pushover.token`, `smtp.password`, `discord.webhookUrl`, `slack.webhookUrl` (a
  // Discord/Slack webhook URL IS the credential — an unguessable token lives in its
  // path) — see `SECRET_KEYS`/`assertNoMaskedSecret`/`sanitizePatch`/`masked()` below for
  // how each is masked, following the existing `mqtt.password` precedent one level
  // deeper (a secret nested inside a nested object).
  alertChannels: z
    .object({
      ntfy: z.object({ serverUrl: z.string().url(), topic: z.string().min(1) }).nullable().optional(),
      pushover: z.object({ token: z.string().min(1), user: z.string().min(1) }).nullable().optional(),
      smtp: z
        .object({
          host: z.string().min(1),
          port: z.number().int().positive(),
          secure: z.boolean(),
          user: z.string().optional(),
          password: z.string().optional(),
          from: z.string().min(1),
          to: z.string().min(1),
        })
        .nullable()
        .optional(),
      discord: z.object({ webhookUrl: z.string().url() }).nullable().optional(),
      slack: z.object({ webhookUrl: z.string().url() }).nullable().optional(),
    })
    .default({}),
});

export type Settings = z.infer<typeof settingsSchema>;

const SECRET_KEYS = ['kegtronApiKey'] as const;

const MASK_PREFIX = '••••';

function isMaskedString(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(MASK_PREFIX);
}

/** A webhook URL's masked display form is `origin + '/…'` (see `maskWebhookUrl` below) —
 * NOT `MASK_PREFIX`-prefixed like every other secret here, since the masked value must
 * still look like a URL for the admin UI's "which webhook is this?" affordance. Detected
 * by shape instead: origin, then a literal single-segment `/…` and nothing else. A real
 * Discord/Slack webhook URL always has multiple path segments (an id + a long token), so
 * this can't collide with a genuine stored value in practice. */
function isMaskedWebhookUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/[^/]+\/…$/.test(v);
}

/** Masks a webhook URL down to its origin — enough for an admin to recognize "yes, this
 * is the Discord webhook" without exposing the secret token embedded in the URL's path.
 * Falls back to a fixed placeholder for a value that (despite passing schema validation)
 * doesn't parse as a URL, which should not be reachable in practice. */
function maskWebhookUrl(url: string): string {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return MASK_PREFIX;
  }
}

/**
 * GET /api/settings replaces secrets with a '••••'-prefixed display mask
 * (see `masked()` below). If a client round-trips that body back through
 * PATCH without editing the secret field, the mask string must never be
 * written as if it were the real secret — that would silently destroy the
 * stored value. This guards both the flat `kegtronApiKey` field and the
 * nested `mqtt.password` field.
 */
function assertNoMaskedSecret<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if ((SECRET_KEYS as readonly string[]).includes(key as string) && isMaskedString(value)) {
    throw new ValidationError(`${key} looks like a masked display value; refusing to store it`);
  }
  if (key === 'mqtt' && value && typeof value === 'object' && isMaskedString((value as any).password)) {
    throw new ValidationError('mqtt.password looks like a masked display value; refusing to store it');
  }
  if (key === 'catalogBeer' && value && typeof value === 'object' && isMaskedString((value as any).apiKey)) {
    throw new ValidationError('catalogBeer.apiKey looks like a masked display value; refusing to store it');
  }
  if (key === 'govee' && value && typeof value === 'object' && isMaskedString((value as any).apiKey)) {
    throw new ValidationError('govee.apiKey looks like a masked display value; refusing to store it');
  }
  if (key === 'updates' && value && typeof value === 'object' && isMaskedString((value as any).watchtowerToken)) {
    throw new ValidationError('updates.watchtowerToken looks like a masked display value; refusing to store it');
  }
  if (key === 'alertChannels' && value && typeof value === 'object') {
    const ac = value as Record<string, any>;
    if (ac.pushover && isMaskedString(ac.pushover.token)) {
      throw new ValidationError('alertChannels.pushover.token looks like a masked display value; refusing to store it');
    }
    if (ac.smtp && isMaskedString(ac.smtp.password)) {
      throw new ValidationError('alertChannels.smtp.password looks like a masked display value; refusing to store it');
    }
    if (ac.discord && isMaskedWebhookUrl(ac.discord.webhookUrl)) {
      throw new ValidationError('alertChannels.discord.webhookUrl looks like a masked display value; refusing to store it');
    }
    if (ac.slack && isMaskedWebhookUrl(ac.slack.webhookUrl)) {
      throw new ValidationError('alertChannels.slack.webhookUrl looks like a masked display value; refusing to store it');
    }
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
   * (mqtt.password) that is still masked is replaced with the currently-stored
   * real value so the rest of that object's edits (e.g. mqtt.url) still apply.
   * Callers should pass the result to `set()` key by key, as the PATCH route does.
   */
  sanitizePatch(patch: Partial<Settings>): Partial<Settings> {
    const out: Partial<Settings> = { ...patch };
    if (isMaskedString(out.kegtronApiKey)) {
      delete out.kegtronApiKey;
    }
    if (out.mqtt && isMaskedString(out.mqtt.password)) {
      out.mqtt = { ...out.mqtt, password: this.get('mqtt')?.password };
    }
    if (out.catalogBeer && isMaskedString(out.catalogBeer.apiKey)) {
      out.catalogBeer = { ...out.catalogBeer, apiKey: this.get('catalogBeer')?.apiKey ?? '' };
    }
    if (out.govee && isMaskedString(out.govee.apiKey)) {
      out.govee = { ...out.govee, apiKey: this.get('govee')?.apiKey ?? '' };
    }
    if (out.updates && isMaskedString(out.updates.watchtowerToken)) {
      out.updates = { ...out.updates, watchtowerToken: this.get('updates')?.watchtowerToken };
    }
    if (out.alertChannels) {
      const stored = this.get('alertChannels');
      const ac = { ...out.alertChannels };
      // Each channel's secret is swapped back in independently — a PATCH round-trips the
      // WHOLE alertChannels object (same "client sends the full object back" idiom as
      // mqtt above), so any subset of channels can be mid-edit (still masked) while
      // others carry a fresh, already-real value in the same request.
      if (ac.pushover && isMaskedString(ac.pushover.token)) {
        ac.pushover = { ...ac.pushover, token: stored?.pushover?.token ?? '' };
      }
      if (ac.smtp && isMaskedString(ac.smtp.password)) {
        ac.smtp = { ...ac.smtp, password: stored?.smtp?.password };
      }
      if (ac.discord && isMaskedWebhookUrl(ac.discord.webhookUrl)) {
        ac.discord = { ...ac.discord, webhookUrl: stored?.discord?.webhookUrl ?? '' };
      }
      if (ac.slack && isMaskedWebhookUrl(ac.slack.webhookUrl)) {
        ac.slack = { ...ac.slack, webhookUrl: stored?.slack?.webhookUrl ?? '' };
      }
      out.alertChannels = ac;
    }
    return out;
  }

  /** Settings safe to send to the frontend: secrets replaced by last-4 masks (or, for
   * webhook URLs, origin + '/…' — see `maskWebhookUrl`). */
  masked(): Settings {
    const s = this.all();
    for (const k of SECRET_KEYS) {
      const v = s[k];
      if (typeof v === 'string' && v.length > 0) {
        (s as any)[k] = '••••' + v.slice(-4);
      }
    }
    if (s.mqtt?.password) s.mqtt.password = '••••';
    if (s.catalogBeer?.apiKey) {
      s.catalogBeer.apiKey = '••••' + s.catalogBeer.apiKey.slice(-4);
    }
    if (s.govee?.apiKey) {
      s.govee.apiKey = '••••' + s.govee.apiKey.slice(-4);
    }
    if (s.updates?.watchtowerToken) {
      // Last-4 on purpose (not the bare-mask password style): the admin CHOSE this
      // token themselves in the compose file, and the tail lets them confirm the two
      // copies match.
      s.updates.watchtowerToken = '••••' + s.updates.watchtowerToken.slice(-4);
    }
    if (s.alertChannels.pushover?.token) {
      s.alertChannels.pushover.token = '••••' + s.alertChannels.pushover.token.slice(-4);
    }
    if (s.alertChannels.smtp?.password) {
      s.alertChannels.smtp.password = '••••';
    }
    if (s.alertChannels.discord?.webhookUrl) {
      s.alertChannels.discord.webhookUrl = maskWebhookUrl(s.alertChannels.discord.webhookUrl);
    }
    if (s.alertChannels.slack?.webhookUrl) {
      s.alertChannels.slack.webhookUrl = maskWebhookUrl(s.alertChannels.slack.webhookUrl);
    }
    return s;
  }
}
