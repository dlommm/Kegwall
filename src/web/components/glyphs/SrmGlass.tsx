import { useId } from 'react';
import { srmToColor } from '../../lib/srm';
import {
  GLASS_SHAPES, GLYPH_LINE, glassShapeForStyle, type GlassShape, type GlyphMode,
} from './glyphShared';

export interface SrmGlassProps {
  /** Beer SRM (null → the srm.ts neutral-amber default). */
  srm: number | null;
  /** Beer style — auto-selects the glass shape unless `shape` overrides it. */
  style?: string | null;
  /** Explicit shape override (per-beer setting). */
  shape?: GlassShape | null;
  /** Liquid fill fraction of the bowl, 0-1. The wall renders a "serving pour"
   * at 0.88 per the design doc; defaults to that. */
  fill?: number;
  /** Rendered width in px; height follows the 60:80 viewBox ratio. */
  width: number;
  mode?: GlyphMode;
  className?: string;
}

/**
 * Dynamic SRM glassware glyph (design 1d): a style-matched vessel whose liquid
 * is the beer's real SRM hex with a lightened foam band on top. Liquid is
 * clipped to the vessel path; `mode` picks the flat/outline/duotone treatment.
 */
export function SrmGlass({
  srm, style, shape, fill = 0.88, width, mode = 'flat', className,
}: SrmGlassProps) {
  const clipId = useId();
  const resolvedShape = shape ?? glassShapeForStyle(style);
  const s = GLASS_SHAPES[resolvedShape];
  const { liquid, highlight } = srmToColor(srm);
  const clampedFill = Math.max(0, Math.min(1, fill));
  const liqY = s.top + (s.bot - s.top) * (1 - clampedFill);

  return (
    <svg
      viewBox="0 0 60 80"
      width={width}
      height={Math.round((width * 80) / 60)}
      className={className}
      style={{ display: 'block' }}
      data-testid="srm-glass"
      data-shape={resolvedShape}
      data-mode={mode}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}><path d={s.d} /></clipPath>
      </defs>
      {mode !== 'outline' && (
        <path
          d={s.d}
          fill={mode === 'duotone' ? liquid : 'rgba(127,127,127,0.10)'}
          fillOpacity={mode === 'duotone' ? 0.18 : 1}
        />
      )}
      <rect
        x={0}
        y={liqY}
        width={60}
        height={s.bot - liqY}
        fill={liquid}
        clipPath={`url(#${clipId})`}
        fillOpacity={mode === 'outline' ? 0.9 : 1}
        data-testid="srm-glass-liquid"
      />
      <rect x={0} y={liqY} width={60} height={3.2} fill={highlight} clipPath={`url(#${clipId})`} />
      <path d={s.d} fill="none" stroke={GLYPH_LINE} strokeWidth={mode === 'outline' ? 2.6 : 2} />
      {s.stroke && <path d={s.stroke} fill="none" stroke={GLYPH_LINE} strokeWidth={2} />}
      {(s.ex ?? []).map((e, i) => (
        // eslint-disable-next-line react/no-array-index-key -- static per-shape geometry
        <rect key={i} x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} fill={GLYPH_LINE} />
      ))}
    </svg>
  );
}
