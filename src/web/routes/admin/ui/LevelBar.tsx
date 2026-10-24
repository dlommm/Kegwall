import type { CSSProperties } from 'react';
import { parseHex, relativeLuminance } from '../../../lib/contrast';

/** True for a stout's near-black, which would vanish on a dark track without an outline. */
export function isDarkBeer(color: string): boolean {
  return parseHex(color) != null && relativeLuminance(color) < 0.03;
}

/** The bar's fill: the beer itself, never lightened (a dark beer gets an outline instead). */
export function barColor(color: string): string {
  return color;
}

/**
 * What's left in a keg as a sight glass (Kegwall 2.1 "w-glass"): the beer at full strength
 * with a foam edge and quarter marks, an amber edge when low, and a warm outline on a stout.
 */
export function LevelBar({ pct, color, low = false }: { pct: number; color: string; low?: boolean }) {
  const width = Math.max(0, Math.min(100, pct));
  const cls = ['adm-level', low ? 'is-low' : '', isDarkBeer(color) ? 'is-dark' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} aria-hidden="true">
      <i style={{ width: `${width}%`, background: barColor(color) } as CSSProperties} />
    </span>
  );
}
