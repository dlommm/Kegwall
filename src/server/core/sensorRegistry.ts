import type { EventBus } from './events.js';
import type { LogService } from './logService.js';

/**
 * Latest ambient-sensor readings (Govee, Phase 6): the Govee poller emits
 * `sensor_reading` bus events; this registry keeps the newest reading per
 * sensor for the wall header strip / dashboard cards (`GET
 * /api/public/sensors`), and watches the cross-sensor temperature spread —
 * a >2.5°F spread between the warmest and coldest sensor logs a warning
 * (design: "spread-alert automation, >2.5°F"), once per crossing.
 */

export const SPREAD_ALERT_F = 2.5;

export interface SensorReading {
  sensorId: string;
  name: string;
  tempC: number | null;
  humidity: number | null;
  ts: string;
}

export class SensorRegistry {
  private readings = new Map<string, SensorReading>();
  private spreadAlerted = false;

  constructor(private bus: EventBus, private log: LogService) {}

  attach(): void {
    this.bus.on('sensor_reading', (e) => {
      this.readings.set(e.sensorId, {
        sensorId: e.sensorId, name: e.name, tempC: e.tempC, humidity: e.humidity, ts: e.ts,
      });
      this.checkSpread();
    });
  }

  list(): SensorReading[] {
    return [...this.readings.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private checkSpread(): void {
    const temps = this.list().map((r) => r.tempC).filter((t): t is number => t != null);
    if (temps.length < 2) return;
    const spreadF = ((Math.max(...temps) - Math.min(...temps)) * 9) / 5;
    if (spreadF > SPREAD_ALERT_F && !this.spreadAlerted) {
      this.spreadAlerted = true;
      this.log.warn('sensors', `Sensor temperature spread ${spreadF.toFixed(1)}°F exceeds the ${SPREAD_ALERT_F}°F alert threshold`);
    } else if (spreadF <= SPREAD_ALERT_F) {
      this.spreadAlerted = false;
    }
  }
}
