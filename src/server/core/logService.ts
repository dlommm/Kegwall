import type Database from 'better-sqlite3';
import type { EventBus } from './events.js';
import {
  insertLog, type LogLevel, type LogSource,
} from '../db/logs.js';
import { insertNotification } from '../db/notificationsRepo.js';

/**
 * The unified log stream's writer (design 5d): every subsystem funnels its
 * operational events here, either directly (`ctx.log.info(...)` from routes)
 * or via the bus subscriptions in `attach()`. Error-level logs also auto-create
 * an in-app notification (design footer: "Errors auto-create a notification")
 * and nudge the admin bell over the existing notifications WS scope.
 */
export class LogService {
  constructor(private db: Database.Database, private bus: EventBus) {}

  log(level: LogLevel, source: LogSource, message: string, detail?: string | null): void {
    try {
      insertLog(this.db, { level, source, message, detail: detail ?? null });
      if (level === 'error') {
        insertNotification(this.db, {
          severity: 'critical', title: `[${source}] ${message}`.slice(0, 200),
        });
        this.bus.emit('state_changed', { scope: 'notifications', ts: new Date().toISOString() });
      }
    } catch {
      // Logging must never take the app down — a failed write is dropped.
    }
  }

  info(source: LogSource, message: string, detail?: string | null): void {
    this.log('info', source, message, detail);
  }

  warn(source: LogSource, message: string, detail?: string | null): void {
    this.log('warn', source, message, detail);
  }

  error(source: LogSource, message: string, detail?: string | null): void {
    this.log('error', source, message, detail);
  }

  /** Subscribes the cross-cutting producers. Direct callers (routes, sources)
   * still log through the methods above for anything with richer context. */
  attach(): void {
    // Source health transitions — logged only on CHANGE so a healthy poll loop
    // doesn't write a row per minute forever.
    const lastHealthy = new Map<string, boolean>();
    this.bus.on('source_status', (e) => {
      const prev = lastHealthy.get(e.source);
      lastHealthy.set(e.source, e.healthy);
      if (prev === e.healthy) return;
      const source: LogSource = e.source === 'mqtt_publisher' ? 'app' : 'kegtron';
      // Never-configured sources (no API key set) log as warn, not error — the
      // error path auto-creates a notification, and a fresh install with no keys
      // shouldn't boot straight into error notifications.
      const level = e.healthy ? 'info' : e.unconfigured ? 'warn' : 'error';
      this.log(level, source, `${e.source} ${e.healthy ? 'healthy' : 'unhealthy'} — ${e.detail}`);
    });

    this.bus.on('device_online', (e) => {
      this.info('kegtron', `Monitor online — ${e.monitor.identifier} port ${e.monitor.portIndex}`);
    });
    this.bus.on('device_offline', (e) => {
      this.warn('kegtron', `Monitor offline — ${e.monitor.identifier} port ${e.monitor.portIndex}`);
    });

    this.bus.on('pour_completed', (e) => {
      this.info('pours', `Pour finished — ${Math.round(e.volumeMl)} mL on ${e.monitor.identifier} port ${e.monitor.portIndex} via ${e.source}`);
    });

    this.bus.on('pour_attributed', (e) => {
      this.info('pours', `Pour attributed — tap ${e.tapNumber}, ${Math.round(e.volumeMl)} mL of ${e.beerName ?? 'unknown beer'} to pourer #${e.drinkerId} (tablet), pour #${e.pourCount}`);
    });

    this.bus.on('keg_tapped', (e) => {
      this.info('app', `Keg tapped — keg #${e.kegId} on tap #${e.tapId}`);
    });
    this.bus.on('keg_kicked', (e) => {
      this.info('app', `Keg kicked — keg #${e.kegId} on tap #${e.tapId}`);
    });

    this.bus.on('alert_fired', (e) => {
      const level: LogLevel = e.severity === 'critical' ? 'error' : e.severity === 'warning' ? 'warn' : 'info';
      this.log(level, 'automations', `Rule "${e.ruleName}" fired — ${e.title}`);
    });

    this.bus.on('wall_banner', (e) => {
      this.info('wall', `Wall banner shown — "${e.text}" (${e.kind})`);
    });
  }
}
