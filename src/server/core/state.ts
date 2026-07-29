import type Database from 'better-sqlite3';
import { monitorRefKey, type EventBus, type MonitorRef } from './events.js';
import { listTaps, getTap } from '../db/taps.js';
import { getBeer, type Beer } from '../db/beers.js';
import {
  getActiveKegForTap, getLatestKickedKegForTap, applyDispense, recordPourTx,
  computeLevelPct, computeRemainingMl, type Keg,
} from '../db/kegs.js';
import {
  upsertMonitor, getMonitorByRef, resolveTapForRef, listMonitors,
} from '../db/monitors.js';
import { recordTelemetrySampled, latestTelemetryForMonitor } from '../db/telemetry.js';
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
  /** The bound monitor's most recent telemetry temperature reading (Celsius), or `null`
   * when the tap has no bound monitor or that monitor hasn't reported telemetry yet.
   * Feeds WallHeader's max-temp readout (see WallPage.tsx). */
  temp: number | null;
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
      this.live.set(monitorRefKey(e.monitor), { pouring: true, curServMl: 0 });
      changed(e.ts);
    });

    this.bus.on('pour_progress', (e) => {
      this.live.set(monitorRefKey(e.monitor), { pouring: true, curServMl: e.curServMl });
      changed(e.ts);
    });

    this.bus.on('pour_completed', (e) => {
      // Live pouring state always clears on completion, even when the pour itself turns
      // out to be a duplicate report — the physical pour did finish, only the recorded
      // transaction is suppressed.
      this.live.delete(monitorRefKey(e.monitor));
      if (this.deduper.shouldRecord(e.monitor, e.volumeMl, e.ts)) {
        const tapId = resolveTapForRef(this.db, e.monitor);
        if (tapId !== null) {
          const keg = getActiveKegForTap(this.db, tapId);
          if (keg) {
            // Phase 5 Task 0 (admin pours management): a device-reported pour is always
            // born unclaimed (no ingest path carries drinker attribution) — if this tap
            // has a configured default drinker, stamp it at creation time instead of
            // leaving the pour to sit unclaimed until someone claims it via the public
            // wall/menu claim flow (or an admin reassigns it later, see
            // routes/crud.ts's PATCH /api/pours/:id/drinker).
            const tap = getTap(this.db, tapId);
            recordPourTx(this.db, {
              kegId: keg.id, ts: e.ts, volumeMl: e.volumeMl,
              durationMs: e.durationMs, source: e.source,
              drinkerId: tap?.defaultDrinkerId ?? null,
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
      this.online.set(monitorRefKey(e.monitor), true); changed(e.ts);
    });
    this.bus.on('device_offline', (e) => {
      this.online.set(monitorRefKey(e.monitor), false); changed(e.ts);
    });
  }

  getTapStates(): TapState[] {
    const monitors = listMonitors(this.db);
    return listTaps(this.db).map((tap) => {
      // A tap with no on_tap keg still needs a KICKED presentation when its last keg was
      // kicked without a replacement — otherwise it reads as a generic empty tap on the
      // wall even though there's a specific "just kicked" beer to show drained/stamped.
      const keg = getActiveKegForTap(this.db, tap.id) ?? getLatestKickedKegForTap(this.db, tap.id);
      const beer = keg ? getBeer(this.db, keg.beerId) : null;
      const mon = monitors.find((m) => m.tapId === tap.id);
      const key = mon ? monitorRefKey({ type: mon.type, identifier: mon.identifier, portIndex: mon.portIndex }) : null;
      const live = key ? this.live.get(key) : undefined;
      const lastPourRow = keg ? listPours(this.db, { kegId: keg.id, limit: 1 })[0] : undefined;
      const temp = mon ? latestTelemetryForMonitor(this.db, mon.id)?.temp ?? null : null;
      return {
        tapId: tap.id,
        tapNumber: tap.number,
        tapName: tap.name,
        beer,
        keg: keg
          ? {
              ...keg,
              levelPct: computeLevelPct(keg.volStartMl, keg.volDispensedMl),
              remainingMl: computeRemainingMl(keg.volStartMl, keg.volDispensedMl),
            }
          : null,
        lastPour: lastPourRow ? { ts: lastPourRow.ts, volumeMl: lastPourRow.volumeMl } : null,
        pouring: live?.pouring ?? false,
        curServMl: live?.curServMl ?? null,
        monitorOnline: key ? this.online.get(key) ?? true : false,
        temp,
      };
    });
  }
}
