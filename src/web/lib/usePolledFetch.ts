import { useEffect, useRef } from 'react';

export interface UsePolledFetchOptions {
  /** Poll cadence in milliseconds. */
  intervalMs: number;
  /**
   * `false` skips the immediate tick when the poll (re)starts — the first tick then
   * waits a full interval (e.g. the Logs live tail, whose initial load is a separate
   * filter-driven fetch). Defaults to `true`.
   */
  immediate?: boolean;
  /** `false` tears the poll down entirely (no timer, no fetch). Defaults to `true`. */
  enabled?: boolean;
  /**
   * Any value change here tears the poll down and restarts it (re-firing the immediate
   * tick when `immediate` is on) — the hook equivalent of listing that value in the
   * hand-rolled effect's dependency array.
   */
  restartKey?: unknown;
}

/**
 * The shared "fetch now, then keep re-fetching on an interval" effect that the
 * dashboard, board, presence, game-strip, tablet and wall pages each used to
 * hand-roll: an immediate tick, a `setInterval` re-tick, and a cancellation flag
 * so responses that land after unmount (or after a restart) are dropped.
 *
 * `tick` receives an `isCancelled` probe to guard its async continuations with
 * (`fetchX().then((r) => { if (!isCancelled()) setState(r); })`), exactly like the
 * `let cancelled = false` closure it replaces. The latest `tick` is always used
 * without restarting the timer, so an inline closure (fresh identity per render)
 * never resets the poll cadence — only `enabled`, `intervalMs`, or `restartKey`
 * changes do.
 */
export function usePolledFetch(
  tick: (isCancelled: () => boolean) => void,
  { intervalMs, immediate = true, enabled = true, restartKey }: UsePolledFetchOptions,
): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const isCancelled = () => cancelled;
    if (immediate) tickRef.current(isCancelled);
    const id = setInterval(() => tickRef.current(isCancelled), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // `restartKey` is an opaque restart trigger, not a read value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, immediate, intervalMs, restartKey]);
}
