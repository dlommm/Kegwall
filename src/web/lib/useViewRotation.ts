import { useEffect, useRef, useState } from 'react';
import type { WallConfig } from '../../server/core/wallConfig.js';

export type RotationView = WallConfig['viewRotation']['views'][number];

/**
 * View rotation (design 4a): cycles through the enabled playlist views on each
 * view's own timer. `interrupt` (a live pour) ALWAYS snaps back to the first
 * 'wall' view and holds there until the pour ends — a pour is the whole point
 * of the wall, so no playlist entry may hide it. When the interrupt clears the
 * rotation resumes from the wall view (its full duration), not mid-timer.
 *
 * Returns the active index into `views` (already-filtered-to-enabled list),
 * 0 when the list is empty or has one entry.
 */
export function useViewRotation(views: RotationView[], interrupt: boolean): number {
  const [index, setIndex] = useState(0);
  const interruptRef = useRef(interrupt);
  interruptRef.current = interrupt;

  // Clamp when the playlist shrinks under the current index.
  const safeIndex = views.length > 0 ? index % views.length : 0;

  useEffect(() => {
    if (views.length <= 1) return undefined;
    if (interrupt) {
      const wallIndex = views.findIndex((v) => v.kind === 'wall');
      if (wallIndex >= 0) setIndex(wallIndex);
      return undefined;
    }
    const current = views[safeIndex];
    if (!current) return undefined;
    const id = setTimeout(() => {
      setIndex((i) => (i + 1) % views.length);
    }, Math.max(3, current.seconds) * 1000);
    return () => clearTimeout(id);
  }, [views, safeIndex, interrupt]);

  return safeIndex;
}
