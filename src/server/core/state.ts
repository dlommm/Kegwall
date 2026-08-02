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
import { recordTelemetrySampled, latestTelemetryForDevice } from '../db/telemetry.js';
import { listPours, countPoursForDrinker } from '../db/pours.js';
import { PourDeduper } from './pourDedupe.js';
import { PourSampleTracker, computePourQuality } from './pourQuality.js';
import type { TabletArmRegistry } from './tabletArm.js';

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
  /** Hidden taps stay in this (admin-consumed) snapshot but are filtered off every
   * public surface: the wall payload's allowedTapIds excludes them server-side, the
   * wall/menu clients re-filter live snapshots, and the HA publisher skips them. */
  hidden: boolean;
  /** The bound monitor's most recent telemetry temperature reading (Celsius), or `null`
   * when the tap has no bound monitor or that monitor hasn't reported telemetry yet.
   * Feeds WallHeader's max-temp readout (see WallPage.tsx). */
  temp: number | null;
  /** Mean rate-after-claim star rating (design 6a) across every rated pour of
   * this beer (all kegs), 1 decimal; null when unrated. */
  avgRating: number | null;
  /** The next on-deck keg's beer name for this tap (design 6e "Next up: X"),
   * or null when nothing is queued. */
  nextUpBeerName: string | null;
}

/** Strips operator-only fields from a TapState before it reaches an unauthenticated or
 * display client. Those are the keg's OWNER-COST fields — `costCents` (what the operator
 * paid), plus (redesign 4k/4l) `depositCents`, `supplierId`, and `purchasedAt`. No wall/menu/
 * board/tablet consumer reads any of them; the hard requirement is that owner cost never
 * appears on a public surface. Hidden-tap filtering is the CALLER's job: the admin snapshot
 * keeps hidden taps, public callers drop them first. Fields are nulled rather than deleted so
 * the `TapState` shape stays intact for typed consumers. */
export function toPublicTapState(t: TapState): TapState {
  // Also strip the beer's operator-only pricing/sourcing config (markup override, exclusive
  // supplier) — the computed DISPLAY price is attached separately by the public route when
  // pricing is enabled; the raw markup/supplier config never ships.
  const beer = t.beer
    ? { ...t.beer, markupOverridePct: null, exclusiveSupplierId: null }
    : t.beer;
  return t.keg
    ? {
      ...t,
      beer,
      keg: {
        ...t.keg, costCents: null, depositCents: null, supplierId: null, purchasedAt: null,
      },
    }
    : { ...t, beer };
}

/** The keg configuration a Kegtron device itself reports for one port — the operator
 * sets size/starting volume in Kegtron's own app when tapping a keg, and both the UDP
 * and cloud-shadow sources relay them on every `volume_update`. Held in memory only:
 * the cloud poll (and any UDP packet) repopulates it within a cycle of a restart, and
 * its sole consumer is a prefill hint, not a system of record. */
export interface DeviceKegInfo {
  sizeMl: number | null;
  volStartMl: number;
  ts: string;
}

export class StateManager {
  private live = new Map<string, { pouring: boolean; curServMl: number | null }>();
  private online = new Map<string, boolean>();
  private deviceKeg = new Map<string, DeviceKegInfo>();
  private deduper = new PourDeduper();
  private samples = new PourSampleTracker();

  /** `tabletArm` (optional — the kiosk feature can be absent in tests): the tablet's
   * armed-pourer slot. An armed pourer is consumed by (and attributed to) the next
   * recorded pour, beating the tap's default drinker — see core/tabletArm.ts. */
  constructor(
    private db: Database.Database,
    private bus: EventBus,
    private tabletArm?: TabletArmRegistry,
  ) {}

  start(): void {
    const changed = (ts: string) => this.bus.emit('state_changed', { scope: 'taps', ts });

    this.bus.on('device_discovered', (e) => {
      upsertMonitor(this.db, e.monitor, { serial: e.serial, meta: e.meta });
      changed(new Date().toISOString());
    });

    this.bus.on('volume_update', (e) => {
      upsertMonitor(this.db, e.monitor);
      // Remember the device's own keg config even for unbound monitors — the swap
      // wizard prefills its Size/Starting volume fields from this.
      this.deviceKeg.set(monitorRefKey(e.monitor), {
        sizeMl: e.sizeMl, volStartMl: e.volStartMl, ts: e.ts,
      });
      const tapId = resolveTapForRef(this.db, e.monitor);
      if (tapId === null) return;
      const keg = getActiveKegForTap(this.db, tapId);
      if (!keg) return;
      applyDispense(this.db, keg.id, e.volDispensedMl);
      changed(e.ts);
    });

    this.bus.on('pour_started', (e) => {
      this.live.set(monitorRefKey(e.monitor), { pouring: true, curServMl: 0 });
      this.samples.begin(e.monitor, Date.parse(e.ts));
      changed(e.ts);
    });

    this.bus.on('pour_progress', (e) => {
      this.live.set(monitorRefKey(e.monitor), { pouring: true, curServMl: e.curServMl });
      this.samples.progress(e.monitor, Date.parse(e.ts), e.curServMl);
      changed(e.ts);
    });

    this.bus.on('pour_completed', (e) => {
      // Live pouring state always clears on completion, even when the pour itself turns
      // out to be a duplicate report — the physical pour did finish, only the recorded
      // transaction is suppressed.
      this.live.delete(monitorRefKey(e.monitor));
      // Samples are taken (and cleared) unconditionally so a suppressed duplicate
      // doesn't leave a stale run to pollute the next pour's score.
      const samples = this.samples.take(e.monitor);
      if (this.deduper.shouldRecord(e.monitor, e.volumeMl, e.ts)) {
        const tapId = resolveTapForRef(this.db, e.monitor);
        if (tapId !== null) {
          const keg = getActiveKegForTap(this.db, tapId);
          if (keg) {
            // Attribution precedence (Pour Wall overhaul Phase 3): the tablet's ARMED
            // pourer wins (an explicit "I'm pouring now" at the kiosk, consumed one
            // pour per arming — see core/tabletArm.ts), then the tap's configured
            // default drinker (Phase 5 Task 0, admin pours management), else the pour
            // is born unclaimed for the public claim flow / admin reassignment.
            const armedDrinkerId = this.tabletArm?.consume() ?? null;
            const tap = getTap(this.db, tapId);
            const { pour } = recordPourTx(this.db, {
              kegId: keg.id, ts: e.ts, volumeMl: e.volumeMl,
              durationMs: e.durationMs, source: e.source,
              drinkerId: armedDrinkerId ?? tap?.defaultDrinkerId ?? null,
              quality: computePourQuality(samples),
            });
            if (armedDrinkerId !== null) {
              const beer = getBeer(this.db, keg.beerId);
              this.bus.emit('pour_attributed', {
                drinkerId: armedDrinkerId,
                pourId: pour.id,
                tapId,
                tapNumber: tap?.number ?? 0,
                beerName: beer?.name ?? null,
                volumeMl: e.volumeMl,
                pourCount: countPoursForDrinker(this.db, armedDrinkerId),
                ts: e.ts,
              });
            }
          }
        }
      }
      changed(e.ts);
    });

    this.bus.on('telemetry', (e) => {
      // Unconditional upsert (not get-or-create): Govee discovery emits are cached to
      // one per device, so this is what keeps a sensor row's last_seen fresh.
      const mon = upsertMonitor(this.db, e.monitor);
      recordTelemetrySampled(this.db, mon.id, e.temp, e.humidity, e.ts);
    });

    this.bus.on('device_online', (e) => {
      this.online.set(monitorRefKey(e.monitor), true); changed(e.ts);
    });
    this.bus.on('device_offline', (e) => {
      this.online.set(monitorRefKey(e.monitor), false); changed(e.ts);
    });
  }

  /** The keg config this monitor's own device last reported (null until a
   * `volume_update` has arrived since boot). */
  deviceKegInfo(ref: MonitorRef): DeviceKegInfo | null {
    return this.deviceKeg.get(monitorRefKey(ref)) ?? null;
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
      // Device-level: temp arrives once per physical Kegtron (recorded on port 0),
      // so a tap bound to port 2 reads its DEVICE's telemetry, not its port row's.
      const temp = mon ? latestTelemetryForDevice(this.db, mon.type, mon.identifier)?.temp ?? null : null;
      // Rate-after-claim average (6a): over every rated pour of this BEER, any keg.
      const avgRatingRow = beer
        ? this.db.prepare(`
            SELECT AVG(p.rating) avg FROM pours p
            JOIN kegs k ON k.id = p.keg_id
            WHERE k.beer_id = ? AND p.rating IS NOT NULL
          `).get(beer.id) as { avg: number | null }
        : null;
      // "Next up" (6e): first queued on-deck keg's beer for this tap.
      const nextUpRow = this.db.prepare(`
        SELECT b.name FROM kegs k JOIN beers b ON b.id = k.beer_id
        WHERE k.tap_id = ? AND k.status = 'on_deck' ORDER BY k.id LIMIT 1
      `).get(tap.id) as { name: string } | undefined;
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
        hidden: tap.hidden,
        temp,
        avgRating: avgRatingRow?.avg != null ? Math.round(avgRatingRow.avg * 10) / 10 : null,
        nextUpBeerName: nextUpRow?.name ?? null,
      };
    });
  }
}
