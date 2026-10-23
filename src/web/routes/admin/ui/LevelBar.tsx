import type { CSSProperties } from 'react';
import { parseHex, relativeLuminance } from '../../../lib/contrast';
import { mixHex } from '../../../lib/srm';

/** A stout's near-black would vanish on the dark track; lift it until it reads as a fill. */
export function barColor(color: string): string {
  if (!parseHex(color)) return color;
  return relativeLuminance(color) < 0.03 ? mixHex(color, '#F7F4EE', 0.3) : color;
}

/** What's left in a keg as a thin bar in the beer's color (amber track when low). */
export function LevelBar({ pct, color, low = false }: { pct: number; color: string; low?: boolean }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <span className={low ? 'adm-level is-low' : 'adm-level'} aria-hidden="true">
      <i style={{ width: `${width}%`, background: barColor(color) } as CSSProperties} />
    </span>
  );
}
