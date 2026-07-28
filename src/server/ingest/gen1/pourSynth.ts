import { monitorRefKey, type EventBus, type MonitorRef } from '../../core/events.js';

// ---------------------------------------------------------------------------
// Shared Gen 1 pour synthesis. Gen 1 Kegtron devices (KT-100/KT-200) only ever report
// two cumulative counters -- volStart (mL already poured from this keg before the app
// started watching, i.e. the device's running total at fill/reset time) and volDisp
// (mL dispensed since then) -- via periodic snapshots (BLE adverts every few seconds,
// or the same numbers relayed over MQTT by a Theengs-style bridge, see mqttSource.ts).
// There is no discrete "pour started"/"pour ended" signal like Kegtron Pro's UDP
// curServ field (see udpSource.ts's header comment) -- a pour has to be INFERRED from
// volDisp rising and then holding steady. This class is that inference, shared
// identically by mqttSource.ts and bleSource.ts (task-7 brief: "shares the SAME
// PourSynthesizer class") so a Gen 1 device behaves identically regardless of which
// transport is currently feeding it -- see BLE/MQTT dedupe in both sources' header
// comments for how only one transport ever feeds a given MAC at a time.
//
// Design (binding, task-7 brief):
//   - `onReading()` ALWAYS emits `volume_update` -- every snapshot is forwarded as-is,
//     purely as a live gauge reading, independent of the pour inference below.
//   - A CUMULATIVE rise in volDisp of >= thresholdMl (20 mL, brief) from the current
//     per-ref baseline arms/re-arms a stabilizeMs (5 s, brief) debounce timer for that
//     ref. If volDisp keeps rising, the timer keeps getting pushed out; once the
//     window elapses with no further rise, it fires a single
//     `pour_completed {source:'ble'}` for the total rise since the baseline, then the
//     baseline moves to that settled value so the NEXT pour measures from zero again.
//   - A rise that never reaches the threshold is silently ignored (no timer, no
//     event) -- brief: "delta below threshold ignored".
//   - A DECREASE in volDisp (device/keg reset -- Gen 1 devices zero their dispensed
//     counter when a fresh keg is tapped) immediately rebaselines to the new lower
//     value and cancels any pending timer, with no event emitted -- brief: "decrease
//     (reset) rebaselines silently". This takes priority over any in-flight pending
//     pour: a reset always wins.
//   - `pour_completed.source` is always 'ble' per the EventMap union (events.ts) --
//     this covers BOTH bleSource.ts (direct BLE adverts) and mqttSource.ts (adverts
//     relayed over MQTT), since from the data model's perspective both are the same
//     underlying Gen 1 BLE advertisement data; there is no separate 'mqtt' source tag.
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD_ML = 20;
const DEFAULT_STABILIZE_MS = 5_000;

export interface PourSynthesizerOptions {
  /** Minimum cumulative rise (mL) from baseline before a pour is considered "real" and
   * a stabilize timer is armed. Production default 20 (brief). */
  thresholdMl?: number;
  /** How long volDisp must hold steady (no further rise) before a pending pour is
   * finalized as pour_completed. Production default 5000ms (brief's "5 s"). Test-only
   * override -- same established precedent as udpSource.ts's pourTimeoutMs /
   * cloudSource.ts's reconnectBaseMs (see those files' doc comments): lets tests use
   * e.g. 30ms instead of a real 5s wait. (The brief also allows vitest fake timers for
   * this; this repo's existing sources all use the real-timer-with-fast-override
   * approach instead, so this class follows that same precedent for consistency.) */
  stabilizeMs?: number;
  /** Clock override for computing `pour_completed.durationMs`/`ts`. Defaults to
   * `Date.now`. Test-only. */
  now?: () => number;
}

interface RefState {
  /** volDisp value pour-accounting is currently measured from -- the end of the last
   * completed pour, the value at last device reset, or the first reading ever seen. */
  baselineDispensedMl: number;
  /** Most recently observed raw volDisp for this ref (may be mid-rise, not yet
   * settled) -- used both to detect decreases and as the pending pour's live total. */
  lastDispensedMl: number;
  /** Wall-clock ms (per `now()`) when the CURRENT pending pour first crossed
   * thresholdMl -- null when no pour is pending. Used for pour_completed's durationMs. */
  pourStartedAtMs: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PourSynthesizer {
  private readonly bus: EventBus;
  private readonly thresholdMl: number;
  private readonly stabilizeMs: number;
  private readonly now: () => number;
  private readonly refs = new Map<string, RefState>();

  constructor(bus: EventBus, opts: PourSynthesizerOptions = {}) {
    this.bus = bus;
    this.thresholdMl = opts.thresholdMl ?? DEFAULT_THRESHOLD_ML;
    this.stabilizeMs = opts.stabilizeMs ?? DEFAULT_STABILIZE_MS;
    this.now = opts.now ?? Date.now;
  }

  onReading(
    ref: MonitorRef, volStartMl: number, volDispensedMl: number, sizeMl: number | null, ts: string,
  ): void {
    this.bus.emit('volume_update', { monitor: ref, volStartMl, volDispensedMl, sizeMl, ts });

    const key = monitorRefKey(ref);
    let state = this.refs.get(key);
    if (!state) {
      // First-ever reading for this ref establishes the baseline -- nothing to
      // compare against yet, so there is no pour to infer.
      state = {
        baselineDispensedMl: volDispensedMl, lastDispensedMl: volDispensedMl,
        pourStartedAtMs: null, timer: null,
      };
      this.refs.set(key, state);
      return;
    }

    if (volDispensedMl < state.lastDispensedMl) {
      // Device/keg reset: rebaseline silently, drop any pending pour.
      this.clearTimer(state);
      state.baselineDispensedMl = volDispensedMl;
      state.lastDispensedMl = volDispensedMl;
      state.pourStartedAtMs = null;
      return;
    }

    if (volDispensedMl === state.lastDispensedMl) return; // no change -- nothing to do

    state.lastDispensedMl = volDispensedMl;
    const delta = volDispensedMl - state.baselineDispensedMl;
    if (delta < this.thresholdMl) return; // below threshold -- ignored (brief)

    if (state.pourStartedAtMs === null) state.pourStartedAtMs = this.now();
    this.clearTimer(state);
    state.timer = setTimeout(() => this.finalize(ref, state!), this.stabilizeMs);
  }

  /** Cancels every pending stabilize timer and forgets all per-ref state. Call this
   * from an owning Source's stop() ONLY when that source constructed its own private
   * PourSynthesizer (i.e. did not receive one via constructor injection) -- a synth
   * shared between mqttSource and bleSource (Task 8's cross-source wiring) must not be
   * torn down just because one of its two feeders stopped. */
  dispose(): void {
    for (const state of this.refs.values()) this.clearTimer(state);
    this.refs.clear();
  }

  private finalize(ref: MonitorRef, state: RefState): void {
    state.timer = null;
    const volumeMl = state.lastDispensedMl - state.baselineDispensedMl;
    const durationMs = state.pourStartedAtMs !== null
      ? Math.max(0, this.now() - state.pourStartedAtMs)
      : null;
    state.baselineDispensedMl = state.lastDispensedMl; // next pour measures from here
    state.pourStartedAtMs = null;
    this.bus.emit('pour_completed', {
      monitor: ref, volumeMl, durationMs, source: 'ble', ts: new Date(this.now()).toISOString(),
    });
  }

  private clearTimer(state: RefState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
}
