import { useEffect, useState } from 'react';
import type { TapState } from '../../server/core/state.js';
import type { WallConfig } from '../../server/core/wallConfig.js';

export type WallPageDef = WallConfig['pages'][number];

/**
 * Splits the wall's global tap list (see useWallData's doc note: `taps` is always the
 * unfiltered global set once the WS snapshot lands) into per-page subsets, per the Task
 * 5 plan:
 * - `pages` empty (no pages configured at all) -> a single page showing every tap.
 * - An individual page with an empty `tapIds` list -> that page also shows every tap.
 * - Otherwise -> that page shows just its listed tapIds, in the global tap list's own
 *   order (not the order tapIds happens to list them in).
 */
export function resolveWallPages(pages: WallPageDef[], taps: TapState[]): TapState[][] {
  const effective = pages.length > 0 ? pages : [{ tapIds: [] }];
  return effective.map((page) => (
    page.tapIds.length === 0
      ? taps
      : taps.filter((t) => page.tapIds.includes(t.tapId))
  ));
}

/**
 * The pages a wall actually shows: its configured pages, or — with none configured and more
 * taps than the look holds (`autoSize`, the look's density ladder) — the taps in look-sized
 * chunks. Shared by the wall and the Wall Editor's preview so both page the same way.
 */
export function wallPagesFor(pages: WallPageDef[], taps: TapState[], autoSize: number): TapState[][] {
  if (pages.length === 0 && taps.length > autoSize) {
    const chunks: TapState[][] = [];
    for (let i = 0; i < taps.length; i += autoSize) chunks.push(taps.slice(i, i + autoSize));
    return chunks;
  }
  return resolveWallPages(pages, taps);
}

/**
 * Rotates a page index 0..pageCount-1 every `rotationSeconds`, wrapping back to 0. Zero
 * or one page never starts a timer — there is nothing to rotate to. If `pageCount`
 * shrinks to or below the current index (e.g. a wall config reload drops pages), the
 * index resets to 0 rather than pointing past the end of the new page list.
 */
export function useRotatingPageIndex(pageCount: number, rotationSeconds: number): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= pageCount) setIndex(0);
    // Only `pageCount` should trigger this correction; `index` itself is read, not a
    // dependency this effect should re-run for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  useEffect(() => {
    if (pageCount <= 1) return undefined;
    const intervalMs = Math.max(1, rotationSeconds) * 1000;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % pageCount);
    }, intervalMs);
    return () => clearInterval(id);
  }, [pageCount, rotationSeconds]);

  return index;
}
