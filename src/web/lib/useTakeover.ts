import { useEffect, useRef, useState } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';

/**
 * The pour-takeover state machine (design turns 2 + 9). Watches the live tap
 * feed for a pour and drives three phases:
 *
 *   idle → active (a tap is pouring AND its live counter has passed the
 *   configured `minMl` trigger threshold) → complete (the pour ended — hold a
 *   "pour complete" splash showing the final volume for ~2.5s) → idle.
 *
 * A new qualifying pour during the complete splash cuts straight back to
 * active. If several taps pour at once the first to qualify keeps the
 * takeover until it finishes (a TV can only take over for one pour at a time).
 *
 * The live volume comes from `TapState.curServMl` (the UDP `curServMl`
 * counter relayed through the `/ws` snapshot feed, which broadcasts on every
 * pour-progress packet). The pour's final volume is the last counter value
 * seen before `pouring` flipped false — the recorded pour row's exact volume
 * arrives later via a different path, and the splash shouldn't wait for it.
 */

export const TAKEOVER_COMPLETE_MS = 2500;

export type TakeoverState =
  | { phase: 'idle'; tap: null; pourMl: 0 }
  | { phase: 'active'; tap: TapState; pourMl: number }
  | { phase: 'complete'; tap: TapState; pourMl: number };

const IDLE: TakeoverState = { phase: 'idle', tap: null, pourMl: 0 };

function qualifies(tap: TapState, minMl: number): boolean {
  return tap.pouring && tap.keg?.status !== 'kicked' && (tap.curServMl ?? 0) >= minMl;
}

export function useTakeover(
  taps: TapState[],
  takeover: WallConfig['takeover'] | undefined,
  completeMs: number = TAKEOVER_COMPLETE_MS,
): TakeoverState {
  const style = takeover?.style ?? 'off';
  const minMl = takeover?.minMl ?? 60;
  const enabled = style !== 'off';

  const [state, setState] = useState<TakeoverState>(IDLE);
  // The active tap's id + last seen counter, tracked in refs so the effect
  // below can read them without re-running on every counter tick it causes.
  const activeTapIdRef = useRef<number | null>(null);
  const lastMlRef = useRef(0);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      activeTapIdRef.current = null;
      lastMlRef.current = 0;
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      setState(IDLE);
      return;
    }

    const activeId = activeTapIdRef.current;
    const activeTap = activeId != null ? taps.find((t) => t.tapId === activeId) : undefined;

    if (activeTap && activeTap.pouring) {
      // Still pouring: track the counter.
      lastMlRef.current = Math.max(lastMlRef.current, activeTap.curServMl ?? 0);
      setState({ phase: 'active', tap: activeTap, pourMl: activeTap.curServMl ?? lastMlRef.current });
      return;
    }

    if (activeTap && !activeTap.pouring) {
      // The takeover pour just ended: hold the complete splash, then go idle.
      const finalMl = lastMlRef.current;
      activeTapIdRef.current = null;
      lastMlRef.current = 0;
      setState({ phase: 'complete', tap: activeTap, pourMl: finalMl });
      completeTimerRef.current = setTimeout(() => {
        completeTimerRef.current = null;
        setState((s) => (s.phase === 'complete' ? IDLE : s));
      }, completeMs);
      return;
    }

    // No active takeover pour — adopt the first qualifying one (this also cuts
    // a complete splash short when a new pour starts).
    const candidate = taps.find((t) => qualifies(t, minMl));
    if (candidate) {
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      activeTapIdRef.current = candidate.tapId;
      lastMlRef.current = candidate.curServMl ?? 0;
      setState({ phase: 'active', tap: candidate, pourMl: candidate.curServMl ?? 0 });
    }
  }, [taps, enabled, minMl, completeMs]);

  // Unmount cleanup only — the complete timer must survive taps re-renders.
  useEffect(() => () => {
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
  }, []);

  return enabled ? state : IDLE;
}
