import { useCallback, useState } from 'react';
import { postPresenceWake } from './api';

/** A wall's server-owned display power stage (Plan A / Task 8's presence engine).
 * `'active'` is the normal fully-lit state; `'screensaver'` dims and shows the OLED-care
 * overlay (ScreenCare.tsx); `'off'` blanks the display entirely. The server is the sole
 * authority on timing (idle debounce, motion, schedule) — the web client only renders
 * whatever stage it's told. */
export type PowerStage = 'active' | 'screensaver' | 'off';

const POWER_STAGES: readonly PowerStage[] = ['active', 'screensaver', 'off'];

/** The WS frame routes/ws.ts broadcasts on every `display_power_changed` transition, and
 * replays per-zone on connect (`{type:'display_power', wallId, wallSlug, state, ts}`) —
 * only the two fields this client actually needs are asserted here. */
export interface DisplayPowerMessage {
  type: 'display_power';
  wallSlug: string;
  state: PowerStage;
}

export function isDisplayPowerMessage(msg: unknown): msg is DisplayPowerMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: unknown; wallSlug?: unknown; state?: unknown };
  return m.type === 'display_power'
    && typeof m.wallSlug === 'string'
    && typeof m.state === 'string'
    && POWER_STAGES.includes(m.state as PowerStage);
}

export interface UseDisplayPowerResult {
  /** The wall's current stage — `'active'` until the server says otherwise (matches the
   * server's own default zone state, so there's no flash-of-wrong-stage before the WS
   * frame arrives on mount). */
  stage: PowerStage;
  /** Feed every WS message here (chain it into an existing `onMessage` handler, e.g.
   * the one WallPage already passes to `useWallData`) — stable identity across renders,
   * so handing it to another `useCallback`'s dependency array doesn't churn that
   * callback's own identity on every render. Frames for a different wall slug (the /ws
   * feed is global, not per-wall) and any non-display_power message are silently ignored. */
  onWsMessage: (msg: unknown) => void;
  /** POSTs /api/presence/wake for this wall (a user tap on the screensaver/off overlay,
   * or a camera-driven wake) — fire-and-forget, never throws. */
  wake: (source?: 'touch' | 'camera') => void;
}

/**
 * Tracks a wall's server-pushed power stage. Replaces the old client-owned screensaver
 * timer (Task 9): the presence engine (Task 8) now decides when a wall dims or blanks,
 * and pushes the result over the same `/ws` socket WallPage already has open (see
 * routes/ws.ts's `display_power` broadcast + its per-zone on-connect replay).
 */
export function useDisplayPower(slug: string | undefined): UseDisplayPowerResult {
  const [stage, setStage] = useState<PowerStage>('active');

  const onWsMessage = useCallback((msg: unknown) => {
    if (!isDisplayPowerMessage(msg)) return;
    if (msg.wallSlug !== slug) return;
    setStage(msg.state);
  }, [slug]);

  const wake = useCallback((source: 'touch' | 'camera' = 'touch') => {
    void postPresenceWake(slug, source);
  }, [slug]);

  return { stage, onWsMessage, wake };
}
