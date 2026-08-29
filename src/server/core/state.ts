import type Database from 'better-sqlite3';
import { monitorRefKey, type EventBus, type MonitorRef } from './events.js';
import { listTaps, getTap } from '../db/taps.js';
import { getBeer, listBeers, type Beer } from '../db/beers.js';
import {
  getActiveKegForTap, getActiveKegsByTap, getLatestKickedKegsByTap,
  applyDispense, recordPourTx,
  computeLevelPct, computeRemainingMl, type Keg,
} from '../db/kegs.js';
import {
  upsertMonitor, getMonitorByRef, resolveTapForRef, listMonitors,
} from '../db/monitors.js';
import { recordTelemetrySampled, latestTelemetryForDevice } from '../db/telemetry.js';
import { latestPourByKeg, countPoursForDrinker } from '../db/pours.js';
import { PourDeduper } from './pourDedupe.js';
import { PourSampleTracker, computePourQuality } from './pourQuality.js';
import type { TabletArmRegistry } from './tabletArm.js';
import { ValidationError } from './errors.js';

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
  // Test-pour overlay, keyed by tapId (independent of any bound monitor), so `simulatePour`
  // works even before Kegtron devices are wired. Read in getTapStates alongside `live`.
  private simLive = new Map<number, { pouring: boolean; curServMl: number }>();
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private simHold: ReturnType<typeof setTimeout> | null = null;
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
      // A disabled device (hardware at another location) still upserts — last-seen stays
      // honest and the row stays re-enable-able — but nothing downstream reacts to it.
      if (!upsertMonitor(this.db, e.monitor).enabled) return;
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

    // A pour from a disabled device never reaches the live wall state (an unknown,
    // not-yet-discovered device counts as enabled — discovery upserts it soon after).
    const refEnabled = (ref: MonitorRef) => getMonitorByRef(this.db, ref)?.enabled !== false;

    this.bus.on('pour_started', (e) => {
      if (!refEnabled(e.monitor)) return;
      this.live.set(monitorRefKey(e.monitor), { pouring: true, curServMl: 0 });
      this.samples.begin(e.monitor, Date.parse(e.ts));
      changed(e.ts);
    });

    this.bus.on('pour_progress', (e) => {
      if (!refEnabled(e.monitor)) return;
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
      if (refEnabled(e.monitor) && this.deduper.shouldRecord(e.monitor, e.volumeMl, e.ts)) {
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
      // one per device, so this is what keeps a sensor row's last_seen fresh. Disabled
      // devices keep their last_seen but record no telemetry history.
      const mon = upsertMonitor(this.db, e.monitor);
      if (!mon.enabled) return;
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
    // Every consumer of `state_changed` re-derives this snapshot, and `pour_progress`
    // fires it many times a second during an active pour — so everything per-tap here is
    // batched into a fixed handful of all-taps queries instead of ~6 queries PER tap
    // (the observed ~200 queries/sec storm). Each batch query returns the exact rows the
    // old per-tap query did (see the helpers' doc comments); the derived numbers — and
    // the formulas in db/stats.ts / db/kegs.ts they're deliberately kept in sync with —
    // are untouched.
    const monitors = listMonitors(this.db);
    const taps = listTaps(this.db);
    const activeByTap = getActiveKegsByTap(this.db);
    const kickedByTap = getLatestKickedKegsByTap(this.db);
    const beersById = new Map(listBeers(this.db).map((b): [number, Beer] => [b.id, b]));
    // A tap with no on_tap keg still needs a KICKED presentation when its last keg was
    // kicked without a replacement — otherwise it reads as a generic empty tap on the
    // wall even though there's a specific "just kicked" beer to show drained/stamped.
    const kegByTap = new Map<number, Keg>();
    for (const tap of taps) {
      const keg = activeByTap.get(tap.id) ?? kickedByTap.get(tap.id);
      if (keg) kegByTap.set(tap.id, keg);
    }
    const lastPourByKeg = latestPourByKeg(this.db, [...kegByTap.values()].map((k) => k.id));
    // Rate-after-claim average (6a): over every rated pour of a BEER, any keg — one
    // grouped query for all beers (rated pours are a small subset of `pours`).
    const avgRatingByBeer = new Map(
      (this.db.prepare(`
        SELECT k.beer_id beer_id, AVG(p.rating) avg FROM pours p
        JOIN kegs k ON k.id = p.keg_id
        WHERE p.rating IS NOT NULL GROUP BY k.beer_id
      `).all() as { beer_id: number; avg: number | null }[])
        .map((r): [number, number | null] => [r.beer_id, r.avg]),
    );
    // "Next up" (6e): first queued (lowest-id, same row as ORDER BY k.id LIMIT 1)
    // on-deck keg's beer per tap, one grouped query.
    const nextUpByTap = new Map(
      (this.db.prepare(`
        SELECT k.tap_id tap_id, b.name name, MIN(k.id) FROM kegs k
        JOIN beers b ON b.id = k.beer_id
        WHERE k.status = 'on_deck' AND k.tap_id IS NOT NULL GROUP BY k.tap_id
      `).all() as { tap_id: number; name: string }[])
        .map((r): [number, string] => [r.tap_id, r.name]),
    );
    // Device-level: temp arrives once per physical Kegtron (recorded on port 0), so a
    // tap bound to port 2 reads its DEVICE's telemetry, not its port row's — queried
    // once per distinct physical device instead of once per tap.
    const tempByDevice = new Map<string, number | null>();
    const deviceTemp = (type: string, identifier: string): number | null => {
      const deviceKey = `${type} ${identifier}`;
      if (!tempByDevice.has(deviceKey)) {
        tempByDevice.set(
          deviceKey, latestTelemetryForDevice(this.db, type, identifier)?.temp ?? null,
        );
      }
      return tempByDevice.get(deviceKey)!;
    };
    return taps.map((tap) => {
      const keg = kegByTap.get(tap.id) ?? null;
      const beer = keg ? beersById.get(keg.beerId) ?? null : null;
      const mon = monitors.find((m) => m.tapId === tap.id);
      const key = mon ? monitorRefKey({ type: mon.type, identifier: mon.identifier, portIndex: mon.portIndex }) : null;
      const live = (key ? this.live.get(key) : undefined) ?? this.simLive.get(tap.id);
      const lastPourRow = keg ? lastPourByKeg.get(keg.id) : undefined;
      const temp = mon ? deviceTemp(mon.type, mon.identifier) : null;
      const avgRating = beer ? avgRatingByBeer.get(beer.id) ?? null : null;
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
        avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
        nextUpBeerName: nextUpByTap.get(tap.id) ?? null,
      };
    });
  }

  /**
   * Fire a SIMULATED pour on a tap over the live `/ws` feed — the wall's takeover reacts exactly as
   * it does to a real Kegtron pour, but NOTHING is recorded (no fake pour in the DB, no keg drain).
   * Used to validate takeover rendering + push latency on a real display: if the takeover appears
   * on the wall the instant this runs, the socket is healthy. Ramps `curServMl` 0 → 473 mL over a
   * few seconds, holds briefly, then clears. Overlays `simLive` (keyed by tapId) so it works even
   * before any device is bound. Returns the tap it ran on.
   */
  simulatePour(tapId?: number): { tapId: number } {
    const taps = listTaps(this.db);
    const target = tapId != null
      ? taps.find((t) => t.id === tapId)
      : (taps.find((t) => getActiveKegForTap(this.db, t.id) != null) ?? taps[0]);
    if (!target) throw new ValidationError('No tap available to test-pour');
    const id = target.id;
    // ONE test pour at a time, by design (this is a manual "is the socket healthy?" probe,
    // not a multi-tap simulator) — but the ramp/hold timers are shared, and only a ramp's
    // OWN completion path deletes its tap's `simLive` entry. Starting a new test pour must
    // therefore drop every previous overlay too, not just kill the timers: an interrupted
    // tap's `{pouring: true}` entry would otherwise linger until server restart, freezing a
    // phantom live pour on every wall. (The hold timeout is tracked and cleared for the
    // same reason, mirrored: a still-pending hold for THIS tap would fire mid-new-ramp and
    // briefly wipe the fresh overlay.)
    if (this.simTimer) { clearInterval(this.simTimer); this.simTimer = null; }
    if (this.simHold) { clearTimeout(this.simHold); this.simHold = null; }
    this.simLive.clear();
    const changed = () => this.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    const TOTAL = 473; const STEP = 20;
    let ml = 0;
    this.simLive.set(id, { pouring: true, curServMl: 0 });
    changed();
    this.simTimer = setInterval(() => {
      ml = Math.min(TOTAL, ml + STEP);
      this.simLive.set(id, { pouring: true, curServMl: ml });
      changed();
      if (ml >= TOTAL) {
        if (this.simTimer) { clearInterval(this.simTimer); this.simTimer = null; }
        this.simHold = setTimeout(() => { this.simLive.delete(id); changed(); }, 1500);
        this.simHold.unref?.(); // don't keep the process/test event loop alive for the hold
      }
    }, 120);
    this.simTimer.unref?.(); // ditto for the ramp
    return { tapId: id };
  }
}
