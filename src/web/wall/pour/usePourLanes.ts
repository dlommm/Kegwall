import { useEffect, useRef, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';

/**
 * Kegwall V2 pour engine (blueprint §C.1 v0.5–v0.7). Every pour that passes the wall's trigger
 * (`takeover.minMl`) gets its own LANE; a takeover style draws one lane per active pour, so
 * two taps pouring at once both show. A lane lives through three phases:
 *
 *   pouring  → the tap is pouring; `measuredMl` is the latest Kegtron counter (never more);
 *   finish   → the tap stopped; the lane shows the RECORDED volume once the server's
 *              `pour_recorded` frame arrives (it usually lands just before the snapshot that
 *              clears `pouring`), else the last counter;
 *   leaving  → the lane collapses, then is removed. The wall is back within 6 s.
 */

/** How long the finish holds before the lane starts to leave. */
export const FINISH_HOLD_MS = 4500;
/** The collapse animation before a lane is removed. */
export const LEAVE_MS = 800;
/** A recorded frame matches a lane only if it arrived this close to the lane's end. */
const RECORD_MATCH_MS = 10_000;

export type LanePhase = 'pouring' | 'finish' | 'leaving';

/** A `pour_recorded` WebSocket frame as the wall stores it. */
export interface RecordedPour {
  tapId: number;
  volumeMl: number;
  durationMs: number | null;
  pourerName: string | null;
  pourerPourCount: number | null;
  /** When the wall received it (ms epoch). */
  at: number;
}

export interface PourLane {
  /** Stable React key: tap id + start time. */
  key: string;
  tapId: number;
  /** The tap's latest snapshot while pouring (frozen at the finish). */
  tap: TapState;
  phase: LanePhase;
  /** Highest live counter seen, in mL. */
  measuredMl: number;
  /** The recorded pour's volume, once known. */
  recordedMl: number | null;
  durationMs: number | null;
  pourerName: string | null;
  pourerPourCount: number | null;
  startedAt: number;
}

function qualifies(tap: TapState, minMl: number): boolean {
  return tap.pouring && tap.keg?.status !== 'kicked' && (tap.curServMl ?? 0) >= minMl;
}

/**
 * Lanes for every active pour, oldest first. `recorded` is the wall's list of recent
 * `pour_recorded` frames (newest last). Disabled (`takeover.style` absent) returns [].
 */
export function usePourLanes(
  taps: TapState[],
  takeover: WallConfig['takeover'] | undefined,
  recorded: RecordedPour[],
  now: () => number = Date.now,
): PourLane[] {
  const minMl = takeover?.minMl ?? 60;
  const [lanes, setLanes] = useState<PourLane[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>[]>());

  const schedule = (key: string, fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.set(key, [...(timers.current.get(key) ?? []), t]);
  };

  // Recorded frames: attach to the matching lane (pouring or finishing) of that tap.
  const attachRecorded = (lane: PourLane, list: RecordedPour[], at: number): PourLane => {
    if (lane.recordedMl != null) return lane;
    const match = [...list].reverse().find((r) => r.tapId === lane.tapId && r.at >= lane.startedAt && at - r.at <= RECORD_MATCH_MS);
    return match
      ? {
        ...lane,
        recordedMl: match.volumeMl,
        durationMs: match.durationMs,
        pourerName: match.pourerName,
        pourerPourCount: match.pourerPourCount,
      }
      : lane;
  };

  // The current lanes, read synchronously so transitions (and their timers) are decided
  // once per change rather than inside a state updater React may run twice.
  const lanesRef = useRef<PourLane[]>([]);
  const commit = (next: PourLane[]) => { lanesRef.current = next; setLanes(next); };

  useEffect(() => {
    const at = now();
    const prev = lanesRef.current;
    let changed = false;
    const ended: string[] = [];
    const next = prev.map((lane) => {
      if (lane.phase !== 'pouring') {
        const withRec = attachRecorded(lane, recorded, at);
        if (withRec !== lane) changed = true;
        return withRec;
      }
      const tap = taps.find((t) => t.tapId === lane.tapId);
      if (tap && tap.pouring) {
        const measured = Math.max(lane.measuredMl, tap.curServMl ?? 0);
        const updated = tap === lane.tap && measured === lane.measuredMl ? lane : { ...lane, tap, measuredMl: measured };
        const withRec = attachRecorded(updated, recorded, at);
        if (withRec !== lane) changed = true;
        return withRec;
      }
      changed = true;
      ended.push(lane.key);
      return attachRecorded({ ...lane, phase: 'finish' as const, tap: tap ?? lane.tap }, recorded, at);
    });
    for (const tap of taps) {
      if (!qualifies(tap, minMl)) continue;
      if (next.some((l) => l.tapId === tap.tapId && l.phase === 'pouring')) continue;
      changed = true;
      next.push({
        key: `${tap.tapId}-${at}`,
        tapId: tap.tapId,
        tap,
        phase: 'pouring',
        measuredMl: tap.curServMl ?? 0,
        recordedMl: null,
        durationMs: null,
        pourerName: null,
        pourerPourCount: null,
        startedAt: at,
      });
    }
    if (changed) commit(next);
    // A finished pour holds, then leaves, then goes.
    for (const key of ended) {
      schedule(key, () => commit(lanesRef.current.map((l) => (l.key === key ? { ...l, phase: 'leaving' } : l))), FINISH_HOLD_MS);
      schedule(key, () => {
        commit(lanesRef.current.filter((l) => l.key !== key));
        timers.current.delete(key);
      }, FINISH_HOLD_MS + LEAVE_MS);
    }
    // `now` is a clock injection for tests; it never changes identity in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taps, recorded, minMl]);

  useEffect(() => () => {
    for (const list of timers.current.values()) list.forEach(clearTimeout);
  }, []);

  return takeover ? lanes : [];
}
