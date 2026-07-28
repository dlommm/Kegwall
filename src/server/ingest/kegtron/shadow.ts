import { z } from 'zod';
import type { EventMap, MonitorRef } from '../../core/events.js';

// ---------------------------------------------------------------------------
// Kegtron Pro device-shadow shape (mdash.net GET /api/v2/m/device response,
// and the WS `notify` "updated" payload — same nesting, see docs/kegtron/Notify.md).
//
// Confirmed against docs/kegtron/kegtron-pro.v2.yaml (GetDeviceShadow response
// schema, ~lines 40-618, and the "Example KT-420" sample value, ~lines 620-818):
//
//   {
//     id: string,                                  // device identifier (mdash device id)
//     shadow: { state: { reported: {
//       config: {                                   // read/write config, ~lines 58-341
//         port0..port3: {                            // ~lines 244-259 ($ref port-config,
//           userName, maker, style, abv, ibu, srm,   //   schema defined ~line 2359-2426)
//           volSize, tapLabel, state, ...
//         },
//         ...many global settings (siteName, timezone, alert thresholds, ...)
//       },
//       config_readonly: {                          // ~lines 342-604
//         port0..port3: {                            // ~lines 401-560
//           volStart, volDisp, lastServing, dateTapped, dateCleaned, kFactor, ...
//         },
//         temp, humidity, serialNum, modelNum, fwRev, portCount,   // ~lines 349-593
//         ...other readonly device status (macAddr, wifiMode, presA/B, ...)
//       },
//       online: boolean,                            // ~line 604 — sits directly under
//                                                    // `reported`, NOT under config_readonly
//       ota: { id: string },
//     } } }
//   }
//
// tests/fixtures/kegtron/device-shadow.json mirrors this nesting verbatim — it is a JSON
// transcription of the spec's own "Example KT-420" value.
// ---------------------------------------------------------------------------

export interface ParsedPort {
  portIndex: number;
  name: string | null;
  maker: string | null;
  style: string | null;
  abv: number | null;
  ibu: number | null;
  srm: number | null;
  volSizeMl: number | null;
  volStartMl: number;
  volDispensedMl: number;
  lastServingMl: number | null;
  dateTapped: string | null;
  enabled: boolean;
}

export interface ParsedDevice {
  deviceId: string;
  serial: string | null;
  model: string | null;
  fw: string | null;
  portCount: number;
  temp: number | null;
  humidity: number | null;
  online: boolean;
  ports: ParsedPort[];
}

// Every leaf/branch schema below is tolerant by construction: a wrong type or a missing
// key degrades to a safe fallback (via .catch()) instead of throwing or failing the parent
// object, so parseDeviceShadow() never throws and only returns null when the input isn't
// shaped like a device shadow at all (see deviceShadowSchema — id + shadow.state.reported
// are the only hard requirements).
const strOrNull = z.string().nullable().catch(null);
const numOrNull = z.number().nullable().catch(null);
const numOrZero = z.number().catch(0);

const portConfigSchema = z.object({
  userName: strOrNull,
  maker: strOrNull,
  style: strOrNull,
  abv: numOrNull,
  ibu: numOrNull,
  srm: numOrNull,
  volSize: numOrNull,
  tapLabel: strOrNull,
  state: numOrNull, // 1 = enabled, 0 = disabled (port-config schema, kegtron-pro.v2.yaml ~line 2407)
}).passthrough();

const portReadonlySchema = z.object({
  volStart: numOrZero,
  volDisp: numOrZero,
  lastServing: numOrNull,
  dateTapped: strOrNull,
}).passthrough();

const configSchema = z.object({
  port0: portConfigSchema.optional().catch(undefined),
  port1: portConfigSchema.optional().catch(undefined),
  port2: portConfigSchema.optional().catch(undefined),
  port3: portConfigSchema.optional().catch(undefined),
}).passthrough().optional().catch(undefined);

const configReadonlySchema = z.object({
  port0: portReadonlySchema.optional().catch(undefined),
  port1: portReadonlySchema.optional().catch(undefined),
  port2: portReadonlySchema.optional().catch(undefined),
  port3: portReadonlySchema.optional().catch(undefined),
  temp: numOrNull,
  humidity: numOrNull,
  serialNum: strOrNull,
  modelNum: strOrNull,
  fwRev: strOrNull,
  portCount: numOrNull,
}).passthrough().optional().catch(undefined);

const reportedSchema = z.object({
  config: configSchema,
  config_readonly: configReadonlySchema,
  online: z.boolean().catch(false),
}).passthrough();

// The structural skeleton (id, shadow.state.reported) is the one part that is NOT
// individually .catch()-wrapped — if this doesn't hold, the input isn't a device shadow
// at all and parseDeviceShadow() returns null (see below).
const deviceShadowSchema = z.object({
  id: z.string().min(1),
  shadow: z.object({
    state: z.object({
      reported: reportedSchema,
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const PORT_KEYS = ['port0', 'port1', 'port2', 'port3'] as const;

function derivePortCount(
  config: { port0?: unknown; port1?: unknown; port2?: unknown; port3?: unknown } | undefined,
  configReadonly: { port0?: unknown; port1?: unknown; port2?: unknown; port3?: unknown } | undefined,
): number {
  let count = 0;
  for (let i = 0; i < PORT_KEYS.length; i++) {
    const key = PORT_KEYS[i]!; // safe: i bounded by PORT_KEYS.length
    if (config?.[key] !== undefined || configReadonly?.[key] !== undefined) count = i + 1;
  }
  return count;
}

function normalizeDate(v: string | null | undefined): string | null {
  return v ? v : null;
}

/**
 * Tolerant parser for a Kegtron Pro device shadow (mdash.net response body or WebSocket
 * notify payload). Returns null for anything that isn't shaped like a device shadow;
 * never throws. Missing/malformed ports, config keys, or device-level fields degrade to
 * null/0/false defaults rather than failing the whole parse ("missing ports OK").
 */
export function parseDeviceShadow(shadow: unknown): ParsedDevice | null {
  const result = deviceShadowSchema.safeParse(shadow);
  if (!result.success) return null;

  const { reported } = result.data.shadow.state;
  const { config, config_readonly: configReadonly } = reported;

  const rawPortCount = configReadonly?.portCount ?? null;
  const portCountBase = (rawPortCount !== null && Number.isFinite(rawPortCount) && rawPortCount >= 0)
    ? rawPortCount
    : derivePortCount(config, configReadonly);
  const portCount = Math.max(0, Math.min(PORT_KEYS.length, Math.trunc(portCountBase)));

  const ports: ParsedPort[] = [];
  for (let i = 0; i < portCount; i++) {
    const key = PORT_KEYS[i]!; // safe: i < portCount <= PORT_KEYS.length
    const cfg = config?.[key];
    const ro = configReadonly?.[key];
    ports.push({
      portIndex: i,
      name: cfg?.userName ?? null,
      maker: cfg?.maker ?? null,
      style: cfg?.style ?? null,
      abv: cfg?.abv ?? null,
      ibu: cfg?.ibu ?? null,
      srm: cfg?.srm ?? null,
      volSizeMl: cfg?.volSize ?? null,
      volStartMl: ro?.volStart ?? 0,
      volDispensedMl: ro?.volDisp ?? 0,
      lastServingMl: ro?.lastServing ?? null,
      dateTapped: normalizeDate(ro?.dateTapped),
      enabled: cfg?.state !== 0,
    });
  }

  return {
    deviceId: result.data.id,
    serial: configReadonly?.serialNum ?? null,
    model: configReadonly?.modelNum ?? null,
    fw: configReadonly?.fwRev ?? null,
    portCount,
    temp: configReadonly?.temp ?? null,
    humidity: configReadonly?.humidity ?? null,
    online: reported.online,
    ports,
  };
}

export type ShadowEmission = {
  [K in keyof EventMap]: { event: K; payload: EventMap[K] };
}[keyof EventMap];

/**
 * Pure diff between two parsed device snapshots, producing the bus events a Kegtron Pro
 * cloud source should emit. `prev === null` means "first sight of this device"
 * (discovery) — ports get `device_discovered` + an initial `volume_update` each, but no
 * `pour_completed` (there's no prior reading to diff a pour against; historical pours are
 * backfilled separately via getServings(), see task 3/4). Never throws. ts fields are
 * stamped with the current time (same convention as src/server/core/state.ts).
 */
export function diffToEvents(
  deviceId: string,
  prev: ParsedDevice | null,
  next: ParsedDevice,
): ShadowEmission[] {
  const events: ShadowEmission[] = [];
  const ts = new Date().toISOString();
  const monitor = (portIndex: number): MonitorRef => (
    { type: 'kegtron_pro', identifier: deviceId, portIndex }
  );

  for (const port of next.ports) {
    const prevPort = prev?.ports.find((p) => p.portIndex === port.portIndex) ?? null;

    if (prev === null) {
      events.push({
        event: 'device_discovered',
        payload: {
          monitor: monitor(port.portIndex),
          serial: next.serial ?? undefined,
          portName: port.name ?? undefined,
          meta: {
            maker: port.maker,
            style: port.style,
            abv: port.abv,
            ibu: port.ibu,
            srm: port.srm,
            volSizeMl: port.volSizeMl,
          },
        },
      });
    }

    if (prevPort === null || prevPort.volDispensedMl !== port.volDispensedMl) {
      events.push({
        event: 'volume_update',
        payload: {
          monitor: monitor(port.portIndex),
          volStartMl: port.volStartMl,
          volDispensedMl: port.volDispensedMl,
          sizeMl: port.volSizeMl,
          ts,
        },
      });
    }

    if (
      prevPort !== null
      && port.lastServingMl !== null
      && port.lastServingMl !== prevPort.lastServingMl
      && port.volDispensedMl > prevPort.volDispensedMl
    ) {
      events.push({
        event: 'pour_completed',
        payload: {
          monitor: monitor(port.portIndex),
          volumeMl: port.lastServingMl,
          durationMs: null,
          source: 'cloud',
          ts,
        },
      });
    }
  }

  const tempChanged = prev === null || next.temp !== prev.temp;
  const humidityChanged = prev === null || next.humidity !== prev.humidity;
  if ((tempChanged || humidityChanged) && (next.temp !== null || next.humidity !== null)) {
    events.push({
      event: 'telemetry',
      payload: { monitor: monitor(0), temp: next.temp, humidity: next.humidity, ts },
    });
  }

  return events;
}
