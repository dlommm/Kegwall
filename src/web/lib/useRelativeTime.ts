import { useEffect, useReducer } from 'react';

/** How often the wall re-renders to keep "N min ago" text current (Task 4 plan). */
const DEFAULT_UPDATE_INTERVAL_MS = 30_000;

/**
 * Formats the time elapsed since `fromIso` as short, plain-language text
 * ("just now", "4 min ago", "2 hr ago", "3 days ago"). `now` defaults to the
 * real current time; tests pass a fixed `now` for determinism. An
 * unparsable/future timestamp falls back to "just now" rather than a
 * negative or NaN duration.
 */
export function formatRelativeTime(fromIso: string, now: Date = new Date()): string {
  const fromMs = new Date(fromIso).getTime();
  const diffMs = now.getTime() - fromMs;
  if (!Number.isFinite(fromMs) || diffMs < 1000) return 'just now';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

/**
 * Returns `formatRelativeTime(iso)`, re-rendering every `intervalMs` (default
 * 30s, per the Task 4 plan) so the text stays current without the caller
 * having to poll. Returns `null` for a `null` timestamp (e.g. a tap with no
 * recorded pour yet). The interval is cleared on unmount and whenever `iso`
 * changes.
 */
export function useRelativeTime(
  iso: string | null,
  intervalMs: number = DEFAULT_UPDATE_INTERVAL_MS,
): string | null {
  // The interval only needs to force a re-render; the displayed text is always
  // recomputed fresh (below) against the real current time.
  const [, forceUpdate] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    if (!iso) return undefined;
    const id = setInterval(forceUpdate, intervalMs);
    return () => clearInterval(id);
  }, [iso, intervalMs]);

  return iso ? formatRelativeTime(iso) : null;
}
