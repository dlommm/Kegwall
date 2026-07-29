import { useId } from 'react';
import { GLYPH_LINE, type GlyphMode } from './glyphShared';

/** Hop cone outline (design doc logic class), 0 0 60 80 viewBox. */
const HOP_D = 'M30 8 Q50 24 46 46 Q42 66 30 73 Q18 66 14 46 Q10 24 30 8 Z';
/** The three bract chevrons drawn over the fill. */
const CHEVRONS = ['M20 28 L30 36 L40 28', 'M20 42 L30 50 L40 42', 'M20 56 L30 62 L40 56'];

const HOP_GREEN = '#7FB544';
const HOP_HIGHLIGHT = '#A6CE6E';

export interface HopFillProps {
  /** Beer IBU (null renders an empty cone). */
  ibu: number | null;
  /** IBU that reads as a "full" cone. Wall-configurable 60/100/120 per the
   * handoff; defaults to 100. */
  cap?: number;
  /** Rendered width in px; height follows the 60:80 viewBox ratio. */
  width: number;
  mode?: GlyphMode;
  className?: string;
}

/**
 * Hop bitterness glyph (design 1d): a teardrop hop cone with three chevron
 * bracts, green fill proportional to IBU / `cap`.
 */
export function HopFill({
  ibu, cap = 100, width, mode = 'flat', className,
}: HopFillProps) {
  const clipId = useId();
  const frac = ibu == null || cap <= 0 ? 0 : Math.max(0, Math.min(1, ibu / cap));
  const liqY = 8 + 65 * (1 - frac);

  return (
    <svg
      viewBox="0 0 60 80"
      width={width}
      height={Math.round((width * 80) / 60)}
      className={className}
      style={{ display: 'block' }}
      data-testid="hop-fill"
      data-mode={mode}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}><path d={HOP_D} /></clipPath>
      </defs>
      {mode !== 'outline' && (
        <path
          d={HOP_D}
          fill={mode === 'duotone' ? HOP_GREEN : 'rgba(127,127,127,0.08)'}
          fillOpacity={mode === 'duotone' ? 0.15 : 1}
        />
      )}
      <rect
        x={0}
        y={liqY}
        width={60}
        height={73 - liqY}
        fill={HOP_GREEN}
        clipPath={`url(#${clipId})`}
        fillOpacity={mode === 'outline' ? 0.9 : 1}
        data-testid="hop-fill-liquid"
      />
      <rect x={0} y={liqY} width={60} height={3} fill={HOP_HIGHLIGHT} clipPath={`url(#${clipId})`} />
      {CHEVRONS.map((d) => (
        <path key={d} d={d} fill="none" stroke={GLYPH_LINE} strokeWidth={2} opacity={0.9} />
      ))}
      <path d={HOP_D} fill="none" stroke={GLYPH_LINE} strokeWidth={mode === 'outline' ? 2.6 : 2} />
    </svg>
  );
}
