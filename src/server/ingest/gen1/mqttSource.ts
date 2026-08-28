import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import type { EventBus, MonitorRef } from '../../core/events.js';
import type { Settings, SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';
import { attachMqttLifecycle, emitSourceStatus } from '../mqttLifecycle.js';
import { PourSynthesizer } from './pourSynth.js';

// ---------------------------------------------------------------------------
// Gen 1 (KT-100/KT-200) MQTT source. Gen 1 devices only talk BLE -- they have no
// cloud/WiFi/Ethernet path of their own (unlike Kegtron Pro). This source expects a
// separate BLE-to-MQTT bridge in the style of Theengs Gateway
// (https://github.com/theengs/gateway, whose default topic the settings schema mirrors:
// settings.mqtt.gen1TopicPrefix defaults to 'home/TheengsGateway') to be running
// somewhere on the network, decoding the raw BLE adverts and republishing them as JSON
// over MQTT -- this source subscribes `{gen1TopicPrefix}/#` and picks the Kegtron
// messages back out. bleSource.ts is the alternative, direct-BLE path for when no such
// bridge exists; see BLE/MQTT DEDUPE below for how the two coexist.
//
// *** MANDATORY EXTERNAL VERIFICATION FINDING (2026-07-28) -- READ BEFORE EDITING ***
// The task brief asked us to verify Kegtron's exact Theengs Decoder MQTT property names
// against https://decoder.theengs.io/devices/KEGTRON.html and/or the decoder GitHub repo
// before coding. That page 404s, and live verification against the decoder repo found
// Theengs Decoder has NO built-in Kegtron device profile at all:
//   - https://github.com/theengs/decoder/tree/development/src/devices -- fetched via the
//     GitHub Contents API on both the default branch ("development") and explicitly by
//     name: 123 device *_json.h files, none named/matching Kegtron, KT100, KT200, or "kt".
//   - https://decoder.theengs.io/devices/devices_by_model.html -- the live docs site's
//     VitePress page-hash manifest (window.__VP_HASH_MAP__) lists every compatible-device
//     markdown page by slug; same result, no kegtron/kt100/kt200 entry.
// Real Kegtron Gen 1 BLE support instead lives in Home Assistant's "Passive BLE Monitor"
// custom component (github.com/custom-components/ble_monitor, PR #334, merged 2021-04-29)
// and in the kegtron-ble Bleak-based HA integration
// (https://github.com/Bluetooth-Devices/kegtron-ble) -- whose parser.py is what
// bleSource.ts's decodeKegtronAdvert() ports directly (see that file's header comment).
// Neither of those publishes MQTT in Theengs' JSON envelope shape.
//
// Since there is no real Theengs Kegtron profile to verify a wire format against, the
// parser below targets Theengs' GENERAL MQTT message envelope conventions -- top-level
// "model_id"/"model"/"brand"/"mac" alongside flat device-specific properties, verified
// against real Theengs device definitions, e.g.
// https://github.com/theengs/decoder/blob/development/src/devices/T201_json.h (a real
// device publishes `{"model_id":"T201","model":"TH Sensor","brand":"Oria","mac":"...",
// "tempc":21.4,"hum":45.0,...}`) -- combined with the Kegtron-SPECIFIC property names
// verified from kegtron-ble/parser.py's Home Assistant SensorLibrary usage:
// volume_start / volume_dispensed / keg_size, published there in LITERS (HA's native
// unit for those sensor classes; see bleSource.ts's citation for the raw-mL BLE wire
// values these are derived from). This mapping (parseKegtronMqttMessage below) is a
// documented BEST-EFFORT INFERENCE, not a confirmed real-world payload -- see
// task-7-report.md "Concerns" for the follow-up this needs once a real
// TheengsGateway+Kegtron deployment (or equivalent bridge) exists to verify against. To
// keep the blast radius of being wrong small and contained, the parser also accepts a
// handful of plausible mL-named fallback aliases (see numberField() below) so a
// differently-shaped real payload has a reasonable chance of still working, or is at
// least a one-line fix to numberField()'s key lists rather than a structural rewrite.
//
// BLE/MQTT DEDUPE: `bleActiveMacs` is a Map<mac, lastBleSeenMs> of lowercase MACs the
// sibling Gen1BleSource has decoded an advert from, stamped with the time of the most
// recent one (Task 8's bootstrap constructs one Map and passes it to both sources'
// constructors). Messages for a MAC in that map are dropped here ONLY while the stamp
// is still fresh (within `bleActiveTtlMs` of now) -- direct BLE wins when both paths
// are enabled and BLE is actually, currently working; this source is the fallback both
// for MACs BLE isn't (yet, or ever) reaching AND for a MAC BLE was hearing but has
// since stopped (adapter dropped out, device moved out of range, etc).
//
// Final review I1 fix: this used to be a Set that a MAC, once added, never left --
// one BLE advert would permanently silence the MQTT fallback for that device even
// after BLE genuinely stopped hearing it. The TTL check below is what restores the
// "actively" in "MACs the BLE source is actively hearing" (the original design intent
// per the plan this source was built from).
// ---------------------------------------------------------------------------

const KEGTRON_MODEL_IDS = new Set(['kt-100', 'kt-200', 'kt100', 'kt200']);

// How long a bleActiveMacs stamp is honored before this source treats BLE as no longer
// covering that MAC and resumes processing its own MQTT messages for it. Brief: "within
// the last 5 minutes". Test-only override, same additive-optional-constructor-knob
// precedent as cloudSource.ts's reconnectBaseMs / pourSynth.ts's stabilizeMs.
const DEFAULT_BLE_ACTIVE_TTL_MS = 5 * 60_000;

export interface Gen1MqttSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** Shared BLE-active MAC map (mac -> last-BLE-seen ms; see header comment). Defaults
   * to an empty Map, i.e. no dedupe, so this source works standalone in tests/without
   * bleSource.ts wired up. */
  bleActiveMacs?: Map<string, number>;
  /** Override for how long a bleActiveMacs stamp is honored (ms) before this source
   * resumes processing messages for that MAC itself. Production default 5 minutes
   * (DEFAULT_BLE_ACTIVE_TTL_MS). Test-only knob. */
  bleActiveTtlMs?: number;
  /** Shared PourSynthesizer instance -- pass the SAME instance given to Gen1BleSource
   * so a MAC's pour baseline survives a handoff between the two transports (Task 8).
   * Defaults to a private instance owned (and disposed on stop()) by this source. */
  synth?: PourSynthesizer;
  /** mqtt.js reconnectPeriod override (production default: mqtt.js's own default,
   * 1000ms). Test-only knob, same additive-optional-constructor-knob precedent as
   * cloudSource.ts's reconnectBaseMs / udpSource.ts's pourTimeoutMs. */
  reconnectPeriodMs?: number;
}

interface ParsedKegtronMessage {
  mac: string;
  portIndex: number;
  volStartMl: number;
  volDispensedMl: number;
  sizeMl: number | null;
  model: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Lowercase colon-separated MAC, accepting either the already-colon-separated form
 * (any case) or a bare 12-hex-digit form (some MQTT bridges omit the separators). Null
 * for anything else. */
function normalizeMac(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/:/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(compact)) return null;
  const lower = compact.toLowerCase();
  return lower.match(/.{2}/g)!.join(':');
}

function isKegtronMessage(msg: Record<string, unknown>): boolean {
  const modelId = typeof msg.model_id === 'string' ? msg.model_id.toLowerCase() : '';
  const model = typeof msg.model === 'string' ? msg.model.toLowerCase() : '';
  const brand = typeof msg.brand === 'string' ? msg.brand.toLowerCase() : '';
  return KEGTRON_MODEL_IDS.has(modelId) || model.includes('kegtron') || brand.includes('kegtron');
}

/** Tries each key in `litersKeys` first (value assumed in LITERS, converted to mL --
 * kegtron-ble's verified convention, see header comment), then each key in `mlKeys`
 * (value assumed already in mL, no conversion -- the defensive fallback). Returns
 * `undefined` if none of the keys are present as a finite number. */
function numberField(
  msg: Record<string, unknown>, litersKeys: string[], mlKeys: string[],
): number | undefined {
  for (const key of litersKeys) {
    const v = msg[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 1000);
  }
  for (const key of mlKeys) {
    const v = msg[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  }
  return undefined;
}

/** Derives a 0-based port index. Explicit numeric `port_index`/`portIndex` wins
 * (present in this fixture's KT-200 messages); otherwise defaults to 0, which is
 * correct both for KT-100 (genuinely single-port) and as a safe fallback for any
 * KT-200 message that omits it. */
function portIndexField(msg: Record<string, unknown>): number {
  const v = msg.port_index ?? msg.portIndex;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  return 0;
}

/** Never throws. Returns null for anything not shaped like a Kegtron message on this
 * topic tree (not an object, not a recognized Kegtron model_id/model/brand, missing a
 * valid mac, or missing the volume fields required to feed the synthesizer). */
export function parseKegtronMqttMessage(raw: unknown): ParsedKegtronMessage | null {
  if (!isPlainObject(raw)) return null;
  if (!isKegtronMessage(raw)) return null;
  const mac = normalizeMac(raw.mac ?? raw.id);
  if (!mac) return null;

  const volStartMl = numberField(raw, ['volume_start'], ['volStartMl', 'vol_start_ml', 'volStart', 'vol_start']);
  const volDispensedMl = numberField(
    raw, ['volume_dispensed'], ['volDispensedMl', 'vol_dispensed_ml', 'volDispensed', 'vol_disp'],
  );
  if (volStartMl === undefined || volDispensedMl === undefined) return null;
  const sizeMl = numberField(raw, ['keg_size'], ['sizeMl', 'keg_size_ml', 'kegSizeMl']) ?? null;

  const model = typeof raw.model === 'string' ? raw.model : (typeof raw.model_id === 'string' ? raw.model_id : null);
  return { mac, portIndex: portIndexField(raw), volStartMl, volDispensedMl, sizeMl, model };
}

export class Gen1MqttSource implements Source {
  readonly name = 'gen1_mqtt' as const;

  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly bleActiveMacs: Map<string, number>;
  private readonly bleActiveTtlMs: number;
  private readonly synth: PourSynthesizer;
  private readonly ownsSynth: boolean;
  private readonly reconnectPeriodMs: number | undefined;

  private client: MqttClient | null = null;
  private readonly discovered = new Set<string>();
  private stopped = true;

  constructor(opts: Gen1MqttSourceOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.bleActiveMacs = opts.bleActiveMacs ?? new Map();
    this.bleActiveTtlMs = opts.bleActiveTtlMs ?? DEFAULT_BLE_ACTIVE_TTL_MS;
    this.ownsSynth = opts.synth === undefined;
    this.synth = opts.synth ?? new PourSynthesizer(opts.bus);
    this.reconnectPeriodMs = opts.reconnectPeriodMs;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const cfg = this.settings.get('mqtt');
    if (!cfg) {
      this.emitStatus(false, 'not configured');
      return;
    }
    this.connect(cfg);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.discovered.clear();
    if (this.ownsSynth) this.synth.dispose();
    const client = this.client;
    this.client = null;
    if (client) {
      await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    }
  }

  private connect(cfg: NonNullable<Settings['mqtt']>): void {
    const options: IClientOptions = {
      username: cfg.username,
      password: cfg.password,
      reconnectPeriod: this.reconnectPeriodMs,
    };
    const client = mqtt.connect(cfg.url, options);
    this.client = client;

    // Shared connect-guard + reconnect/close/'error'-swallow scaffolding -- see
    // mqttLifecycle.ts (extracted from this source's original inline handlers; the
    // "never let an unhandled 'error' crash the process" precedent lives there now).
    attachMqttLifecycle(client, {
      isStopped: () => this.stopped,
      emitStatus: (healthy, detail) => this.emitStatus(healthy, detail),
      onConnect: () => {
        client.subscribe(`${cfg.gen1TopicPrefix}/#`, (err) => {
          if (this.stopped) return;
          if (err) {
            this.emitStatus(false, `subscribe failed: ${err.message}`);
            return;
          }
          this.emitStatus(true, `subscribed to ${cfg.gen1TopicPrefix}/#`);
        });
      },
    });

    client.on('message', (_topic, payload) => this.handleMessage(payload));
  }

  private handleMessage(payload: Buffer): void {
    if (this.stopped) return;
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString('utf8'));
    } catch {
      return; // not JSON -- not every message on the tree is necessarily ours
    }
    const parsed = parseKegtronMqttMessage(raw);
    if (!parsed) return;
    const bleLastSeenMs = this.bleActiveMacs.get(parsed.mac);
    // BLE path owns this MAC ONLY while its last-seen stamp is still fresh -- see
    // header comment (Final review I1: a stale/never-updated stamp must not suppress
    // this fallback forever).
    if (bleLastSeenMs !== undefined && Date.now() - bleLastSeenMs < this.bleActiveTtlMs) return;

    const monitor: MonitorRef = { type: 'kegtron_gen1', identifier: parsed.mac, portIndex: parsed.portIndex };
    const key = `${parsed.mac}:${parsed.portIndex}`;
    if (!this.discovered.has(key)) {
      this.discovered.add(key);
      this.bus.emit('device_discovered', {
        monitor,
        meta: parsed.model ? { model: parsed.model } : undefined,
      });
    }

    const ts = new Date().toISOString();
    this.synth.onReading(monitor, parsed.volStartMl, parsed.volDispensedMl, parsed.sizeMl, ts);
    this.emitStatus(true, `last reading from ${parsed.mac} port${parsed.portIndex} at ${ts}`);
  }

  private emitStatus(healthy: boolean, detail: string): void {
    emitSourceStatus(this.bus, 'gen1_mqtt', healthy, detail);
  }
}
