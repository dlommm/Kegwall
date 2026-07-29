import { useId } from 'react';
import { srmToColor } from '../../lib/srm';
import { GLYPH_LINE } from './glyphShared';

/** Mini pint outline (design doc logic class), drawn in a 19px-per-glass strip. */
const MINI_D = 'M3 1 L15 1 L13 23 L5 23 Z';

export interface AbvGlassesProps {
  /** Beer ABV in % (null renders nothing). */
  abv: number | null;
  /** Beer SRM for the liquid tint. */
  srm: number | null;
  /** Rendered height in px (design: 32); width follows the glass count. */
  height?: number;
  className?: string;
}

/**
 * ABV strength glyph (design 1d): one mini pint per 5% ABV — full glasses plus
 * a fractional last one (9.1% → 1 full + a 0.82-filled glass). A minimum
 * visible sliver (0.12) keeps very low fractions legible.
 */
export function AbvGlasses({
  abv, srm, height = 32, className,
}: AbvGlassesProps) {
  const idBase = useId();
  if (abv == null || abv <= 0) return null;

  const { liquid, highlight } = srmToColor(srm);
  const per = abv / 5;
  const n = Math.max(1, Math.ceil(per - 0.05));
  const viewWidth = n * 19 + 1;

  const glasses = [];
  for (let i = 0; i < n; i += 1) {
    const frac = Math.max(0.12, Math.min(1, per - i));
    const liqY = 1 + 22 * (1 - frac);
    const clipId = `${idBase}-${i}`;
    glasses.push(
      <g key={i} transform={`translate(${i * 19},0)`}>
        <defs>
          <clipPath id={clipId}><path d={MINI_D} /></clipPath>
        </defs>
        <rect x={0} y={liqY} width={18} height={23 - liqY} fill={liquid} clipPath={`url(#${clipId})`} />
        <rect x={0} y={liqY} width={18} height={1.8} fill={highlight} clipPath={`url(#${clipId})`} />
        <path d={MINI_D} fill="none" stroke={GLYPH_LINE} strokeWidth={1.4} />
      </g>,
    );
  }

  return (
    <svg
      viewBox={`0 0 ${viewWidth} 25`}
      width={Math.round((viewWidth * height) / 25)}
      height={height}
      className={className}
      style={{ display: 'block' }}
      data-testid="abv-glasses"
      data-count={n}
      aria-hidden="true"
    >
      {glasses}
    </svg>
  );
}
