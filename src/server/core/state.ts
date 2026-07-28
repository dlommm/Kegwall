import type Database from 'better-sqlite3';
import type { EventBus, MonitorRef } from './events.js';
import { listTaps } from '../db/taps.js';
import { getBeer, type Beer } from '../db/beers.js';
import { getActiveKegForTap, applyDispense, recordPourTx, type Keg } from '../db/kegs.js';
import {
  upsertMonitor, getMonitorByRef, resolveTapForRef, listMonitors,
} from '../db/monitors.js';
import { recordTelemetrySampled } from '../db/telemetry.js';
import { listPours } from '../db/pours.js';
import { PourDeduper } from './pourDedupe.js';

export interface TapState {
  tapId: number;
  tapNumber: number;
  tapName: string | null;
  beer: Beer | null;
  keg: (Keg & { levelPct: number; remainingMl: number }) | null;
  lastPour: { ts: string; volumeMl: number } | null;
  pouring: boolean;
  curServMl: number | null;
  monitorOnline: boolean;
}

function refKey(ref: MonitorRef): string {
  return `${ref.type}:${ref.identifier}:${ref.portIndex}`;
}

export class StateManager {
  private live = new Map<string, { pouring: boolean; curServMl: number | null }>();
  private online = new Map<string, boolean>();
  private deduper = new PourDeduper();

  constructor(private db: Database.Database, private bus: EventBus) {}

  start(): void {
    const changed = (ts: string) => this.bus.emit('state_changed', { scope: 'taps', ts });

    this.bus.on('device_discovered', (e) => {
      upsertMonitor(this.db, e.monitor, { serial: e.serial, meta: e.meta });
      changed(new Date().toISOString());
    });

    this.bus.on('volume_update', (e) => {
      upsertMonitor(this.db, e.monitor);
      const tapId = resolveTapForRef(this.db, e.monitor);
      if (tapId === null) return;
      const keg = getActiveKegForTap(this.db, tapId);
      if (!keg) return;
      applyDispense(this.db, keg.id, e.volDispensedMl);
      changed(e.ts);
    });

    this.bus.on('pour_started', (e) => {
      this.live.set(refKey(e.monitor), { pouring: true, curServMl: 0 });
      changed(e.ts);
    });

    this.bus.on('pour_progress', (e) => {
      this.live.set(refKey(e.monitor), { pouring: true, curServMl: e.curServMl });
      changed(e.ts);
    });

    this.bus.on('pour_completed', (e) => {
      // Live pouring state always clears on completion, even when the pour itself turns
      // out to be a duplicate report — the physical pour did finish, only the recorded
      // transaction is suppressed.
      this.live.delete(refKey(e.monitor));
      if (this.deduper.shouldRecord(e.monitor, e.volumeMl, e.ts)) {
        const tapId = resolveTapForRef(this.db, e.monitor);
        if (tapId !== null) {
          const keg = getActiveKegForTap(this.db, tapId);
          if (keg) {
            recordPourTx(this.db, {
              kegId: keg.id, ts: e.ts, volumeMl: e.volumeMl,
              durationMs: e.durationMs, source: e.source,
            });
          }
        }
      }
      changed(e.ts);
    });

    this.bus.on('telemetry', (e) => {
      const mon = getMonitorByRef(this.db, e.monitor) ?? upsertMonitor(this.db, e.monitor);
      recordTelemetrySampled(this.db, mon.id, e.temp, e.humidity, e.ts);
    });

    this.bus.on('device_online', (e) => {
      this.online.set(refKey(e.monitor), true); changed(e.ts);
    });
    this.bus.on('device_offline', (e) => {
      this.online.set(refKey(e.monitor), false); changed(e.ts);
    });
  }

  getTapStates(): TapState[] {
    const monitors = listMonitors(this.db);
    return listTaps(this.db).map((tap) => {
      const keg = getActiveKegForTap(this.db, tap.id);
      const beer = keg ? getBeer(this.db, keg.beerId) : null;
      const mon = monitors.find((m) => m.tapId === tap.id);
      const key = mon ? refKey({ type: mon.type, identifier: mon.identifier, portIndex: mon.portIndex }) : null;
      const live = key ? this.live.get(key) : undefined;
      const lastPourRow = keg ? listPours(this.db, { kegId: keg.id, limit: 1 })[0] : undefined;
      return {
        tapId: tap.id,
        tapNumber: tap.number,
        tapName: tap.name,
        beer,
        keg: keg
          ? {
              ...keg,
              levelPct: keg.volStartMl > 0
                ? Math.max(0, Math.min(100,
                    Math.round(((keg.volStartMl - keg.volDispensedMl) / keg.volStartMl) * 1000) / 10))
                : 0,
              remainingMl: Math.max(0, keg.volStartMl - keg.volDispensedMl),
            }
          : null,
        lastPour: lastPourRow ? { ts: lastPourRow.ts, volumeMl: lastPourRow.volumeMl } : null,
        pouring: live?.pouring ?? false,
        curServMl: live?.curServMl ?? null,
        monitorOnline: key ? this.online.get(key) ?? true : false,
      };
    });
  }
}
