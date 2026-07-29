import type { EventBus } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';

/**
 * Govee ambient sensors (Phase 6): polls the Govee cloud OpenAPI (~60s, per
 * the handoff) for every hygrometer/thermometer on the account and emits a
 * `sensor_reading` per device. Sensor display names come from the
 * `govee.names` settings map (free text — FRONT/MIDDLE/BACK...), falling back
 * to the Govee device name. Temperatures arrive in Fahrenheit from the API
 * and are normalized to Celsius (the app's storage/wire convention — display
 * conversion happens at the edge like everywhere else).
 *
 * Self-skips when no API key is configured (same idiom as the Kegtron cloud
 * source) so registering it unconditionally is safe.
 */

const DEFAULT_POLL_MS = 60_000;

interface GoveeSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  pollMs?: number;
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

  constructor(private opts: GoveeSourceOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    const config = this.opts.settings.get('govee');
    if (!config?.apiKey) {
      this.status(false, 'No Govee API key configured');
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

  private status(healthy: boolean, detail: string): void {
    this.opts.bus.emit('source_status', {
      source: 'govee', healthy, detail, ts: new Date().toISOString(),
    });
  }

  private async poll(): Promise<void> {
    const config = this.opts.settings.get('govee');
    if (!config?.apiKey || this.stopped) return;
    const base = this.opts.settings.get('goveeBaseUrl');
    try {
      const devicesRes = await fetch(`${base}/router/api/v1/user/devices`, {
        headers: { 'Govee-API-Key': config.apiKey },
      });
      if (!devicesRes.ok) {
        this.status(false, `Govee devices request failed (${devicesRes.status})`);
        return;
      }
      const body = await devicesRes.json() as { data?: GoveeDevice[] };
      const devices = body.data ?? [];
      let readings = 0;
      for (const device of devices) {
        const reading = await this.readDevice(base, config.apiKey, device);
        if (this.stopped) return;
        if (reading) {
          readings += 1;
          this.opts.bus.emit('sensor_reading', {
            sensorId: device.device,
            name: config.names[device.device] ?? device.deviceName ?? device.device,
            tempC: reading.tempC,
            humidity: reading.humidity,
            ts: new Date().toISOString(),
          });
        }
      }
      this.status(true, `${readings} sensor(s), next poll in ${Math.round((this.opts.pollMs ?? DEFAULT_POLL_MS) / 1000)}s`);
    } catch (err) {
      this.status(false, err instanceof Error ? err.message : 'Govee poll failed');
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
