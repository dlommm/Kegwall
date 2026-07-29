import { useId } from 'react';
import type { KegAssetId } from '../../lib/kegAssets';
import { GLYPH_LINE, statusToken } from './glyphShared';

/** Body proportions per keg type — same silhouette language (rounded body,
 * chimes, two rolling ribs), with the body width/height nudged so a slim
 * quarter or corny reads narrower than a half barrel (README: "silhouette
 * should match keg type"). The base 32×56 geometry is the design doc's. */
const BODY_VARIANTS: Record<KegAssetId, { w: number; h: number }> = {
  'half-barrel': { w: 36, h: 56 },
  'fifty-liter': { w: 36, h: 56 },
  'quarter-barrel': { w: 32, h: 48 },
  'sixth-barrel': { w: 26, h: 56 },
  cornelius: { w: 24, h: 56 },
  'slim-quarter': { w: 24, h: 56 },
  'mini-keg': { w: 26, h: 40 },
};

const DEFAULT_BODY = { w: 32, h: 56 };

export interface KegSilhouetteProps {
  /** Remaining level, 0-100. */
  levelPct: number;
  /** Keg type for the silhouette proportions (null → the design's default body). */
  kegType?: KegAssetId | null;
  /** Rendered width in px; height follows the 60:80 viewBox ratio. */
  width: number;
  className?: string;
}

/**
 * Keg level glyph (design 1d): a rounded keg body with top/bottom chimes and
 * two rolling ribs; the fill height is the keg's remaining level and its color
 * follows the status thresholds (ok / ≤35% warn / ≤15% danger).
 */
export function KegSilhouette({
  levelPct, kegType, width, className,
}: KegSilhouetteProps) {
  const clipId = useId();
  const frac = Math.max(0, Math.min(1, levelPct / 100));
  const body = (kegType && BODY_VARIANTS[kegType]) || DEFAULT_BODY;
  const x = 30 - body.w / 2;
  // Body is vertically centered in the design's 12..68 band.
  const top = 12 + (56 - body.h) / 2;
  const bot = top + body.h;
  const liqY = top + body.h * (1 - frac);
  const color = statusToken(frac);
  const chimeX = x - 3;
  const chimeW = body.w + 6;
  // Rib positions at the same relative heights as the design's 32/48 on a 12..68 body.
  const rib1 = top + body.h * (20 / 56);
  const rib2 = top + body.h * (36 / 56);

  return (
    <svg
      viewBox="0 0 60 80"
      width={width}
      height={Math.round((width * 80) / 60)}
      className={className}
      style={{ display: 'block' }}
      data-testid="keg-silhouette"
      data-keg-type={kegType ?? 'default'}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}><rect x={x} y={top} width={body.w} height={body.h} rx={6} /></clipPath>
      </defs>
      <rect x={x} y={top} width={body.w} height={body.h} rx={6} fill="rgba(127,127,127,0.08)" />
      <rect
        x={x}
        y={liqY}
        width={body.w}
        height={bot - liqY}
        fill={color}
        clipPath={`url(#${clipId})`}
        data-testid="keg-silhouette-level"
      />
      <line x1={x + 1} y1={rib1} x2={x + body.w - 1} y2={rib1} stroke={GLYPH_LINE} strokeWidth={1.5} opacity={0.35} />
      <line x1={x + 1} y1={rib2} x2={x + body.w - 1} y2={rib2} stroke={GLYPH_LINE} strokeWidth={1.5} opacity={0.35} />
      <rect x={x} y={top} width={body.w} height={body.h} rx={6} fill="none" stroke={GLYPH_LINE} strokeWidth={2} />
      <rect x={chimeX} y={top - 5} width={chimeW} height={5} rx={2.5} fill={GLYPH_LINE} opacity={0.85} />
      <rect x={chimeX} y={bot} width={chimeW} height={5} rx={2.5} fill={GLYPH_LINE} opacity={0.85} />
    </svg>
  );
}
