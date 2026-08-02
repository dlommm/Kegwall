import type { EventBus } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';

/**
 * Govee ambient sensors (Phase 6, made first-class monitors later): polls the Govee
 * cloud OpenAPI (~60s) for every hygrometer/thermometer on the account. Each device
 * becomes a real `monitors` row (`type: 'govee_sensor'`, portIndex 0) via a
 * `device_discovered` emit (cached — only new/changed devices emit, since the
 * StateManager handler broadcasts a full ws snapshot per emit), and every reading is
 * emitted BOTH as `telemetry` (persisted to the telemetry table by StateManager, so
 * Analytics charts it like any Kegtron device) and as `sensor_reading` (the in-memory
 * registry behind the wall header chips). Display name preference: the monitors row's
 * device-level `name` (set on the admin Monitors page), else Govee's own deviceName.
 *
 * Disabled sensors (monitors.enabled = 0, toggled in the admin) are looked up per
 * poll via the injected `sensorMonitor` callback and skipped ENTIRELY — no state
 * request leaves the box for them. Temperatures arrive in Fahrenheit and are
 * normalized to Celsius (the app's storage/wire convention).
 *
 * Self-skips when no API key is configured (same idiom as the Kegtron cloud
 * source) so registering it unconditionally is safe.
 */

const DEFAULT_POLL_MS = 60_000;
/** Per-request cap so a hung Govee upstream can't stall the poll loop indefinitely (every
 * other outbound client in the repo bounds its fetch). Well under the poll interval. */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

interface GoveeSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** Per-poll lookup of the sensor's monitors row (enabled flag + admin-set name);
   * null when no row exists yet (first sighting — treated as enabled). Injected as a
   * db query from bootstrap.ts so the source itself stays db-free and unit-testable,
   * and so an enable/disable takes effect on the very next poll with no source
   * restart. */
  sensorMonitor: (identifier: string) => { enabled: boolean; name: string | null } | null;
  pollMs?: number;
  /** Per-request fetch timeout (ms); defaults to `DEFAULT_FETCH_TIMEOUT_MS`. Test-injectable. */
  fetchTimeoutMs?: number;
}

interface GoveeDevice {
  sku: string;
  device: string;
  deviceName: string;
}

export class GoveeSource implements Source {
  readonly name = 'govee' as const;

  private timer: ReturnType<typeof setInterval> | null = null;

  private stopped = false;

  /** identifier -> deviceName/sku signature of already-announced devices, so
   * `device_discovered` (and its ws-snapshot broadcast) fires once per device, not
   * once per poll. Cleared on start() so a source rebuild re-announces. */
  private discovered = new Map<string, string>();

  constructor(private opts: GoveeSourceOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.discovered.clear();
    const config = this.opts.settings.get('govee');
    if (!config?.apiKey) {
      this.status(false, 'No Govee API key configured', { unconfigured: true });
      return;
    }
    const pollMs = this.opts.pollMs ?? DEFAULT_POLL_MS;
    await this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, pollMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private status(healthy: boolean, detail: string, extra: { unconfigured?: boolean } = {}): void {
    this.opts.bus.emit('source_status', {
      source: 'govee', healthy, detail, ts: new Date().toISOString(), ...extra,
    });
  }

  private async poll(): Promise<void> {
    const config = this.opts.settings.get('govee');
    if (!config?.apiKey || this.stopped) return;
    const base = this.opts.settings.get('goveeBaseUrl');
    try {
      const devicesRes = await fetch(`${base}/router/api/v1/user/devices`, {
        headers: { 'Govee-API-Key': config.apiKey },
        signal: AbortSignal.timeout(this.opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (!devicesRes.ok) {
        this.status(false, `Govee devices request failed (${devicesRes.status})`);
        return;
      }
      const body = await devicesRes.json() as { data?: GoveeDevice[] };
      const devices = body.data ?? [];
      let readings = 0;
      let disabled = 0;
      for (const device of devices) {
        const ref = { type: 'govee_sensor' as const, identifier: device.device, portIndex: 0 };
        const signature = `${device.deviceName ?? ''}\u0000${device.sku ?? ''}`;
        if (this.discovered.get(device.device) !== signature) {
          this.discovered.set(device.device, signature);
          this.opts.bus.emit('device_discovered', {
            monitor: ref, meta: { deviceName: device.deviceName, sku: device.sku },
          });
        }
        // bus.emit is synchronous, so the monitors row exists before this lookup even
        // on the first-ever poll.
        const mon = this.opts.sensorMonitor(device.device);
        if (mon && !mon.enabled) {
          disabled += 1;
          continue; // no state request at all for a disabled sensor
        }
        const reading = await this.readDevice(base, config.apiKey, device);
        if (this.stopped) return;
        if (reading) {
          readings += 1;
          const ts = new Date().toISOString();
          this.opts.bus.emit('telemetry', {
            monitor: ref, temp: reading.tempC, humidity: reading.humidity, ts,
          });
          this.opts.bus.emit('sensor_reading', {
            sensorId: device.device,
            name: mon?.name ?? (device.deviceName || device.device),
            tempC: reading.tempC,
            humidity: reading.humidity,
            ts,
          });
        }
      }
      const disabledNote = disabled > 0 ? `, ${disabled} disabled` : '';
      this.status(true, `${readings} sensor(s)${disabledNote}, next poll in ${Math.round((this.opts.pollMs ?? DEFAULT_POLL_MS) / 1000)}s`);
    } catch {
      // Generic detail, never the raw fetch error — it can embed the request URL. The
      // !ok branches above already report a precise (non-raw) status code where they can.
      this.status(false, 'Govee poll failed (network error or timeout)');
    }
  }

  private async readDevice(
    base: string,
    apiKey: string,
    device: GoveeDevice,
  ): Promise<{ tempC: number | null; humidity: number | null } | null> {
    const res = await fetch(`${base}/router/api/v1/device/state`, {
      method: 'POST',
      headers: { 'Govee-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: String(Date.now()),
        payload: { sku: device.sku, device: device.device },
      }),
      signal: AbortSignal.timeout(this.opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json() as {
      payload?: { capabilities?: { instance?: string; state?: { value?: unknown } }[] };
    };
    const caps = body.payload?.capabilities ?? [];
    const find = (instance: string): number | null => {
      const cap = caps.find((c) => c.instance === instance);
      const value = cap?.state?.value;
      return typeof value === 'number' ? value : null;
    };
    const tempF = find('sensorTemperature');
    const humidity = find('sensorHumidity');
    if (tempF === null && humidity === null) return null;
    return {
      tempC: tempF !== null ? Math.round(((tempF - 32) * 5) / 9 * 10) / 10 : null,
      humidity,
    };
  }
}
