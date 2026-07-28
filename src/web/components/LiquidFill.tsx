import { useMemo, type CSSProperties } from 'react';
import { srmToColor } from '../lib/srm';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { formatVolumeMl, type VolumeUnits } from '../lib/units';

export interface LiquidFillProps {
  /** Fill level as a percent (0-100); out-of-range values are clamped. */
  levelPct: number;
  /** The beer's SRM value (see `srmToColor`); `null` renders the neutral default tint. */
  srm: number | null;
  /** True while a pour is actively in progress on this tap. */
  pouring: boolean;
  /** Current in-progress serving volume in mL, shown as a running readout while pouring. */
  curServMl: number | null;
  /** Unit system for the pour readout. Defaults to `'us'`. */
  units?: VolumeUnits;
  className?: string;
}

/** Foam head height, as a percent of the SVG viewBox, capped by the liquid's own height. */
const FOAM_HEIGHT_PCT = 3;

/**
 * The wall's signature element (see the Phase 3 plan's "Visual design
 * direction"): an SVG liquid column tinted by the beer's real SRM color, with
 * a foam head line at the surface. While a pour is in progress the surface
 * gets a gentle ripple and the container gets a soft glow — the ONE
 * orchestrated moment of motion on the wall; both are CSS animations that are
 * fully skipped under `prefers-reduced-motion` (level changes still happen,
 * they just jump instead of transitioning/animating).
 */
export function LiquidFill({
  levelPct, srm, pouring, curServMl, units = 'us', className,
}: LiquidFillProps) {
  const reducedMotion = usePrefersReducedMotion();
  const clampedLevel = Math.max(0, Math.min(100, levelPct));
  const { liquid, highlight } = useMemo(() => srmToColor(srm), [srm]);

  // The ripple/glow are tied to `pouring`, but only when motion is allowed —
  // per the design direction, reduced motion drops the animation, not the
  // underlying pouring *state* (the readout below still appears either way).
  const animated = pouring && !reducedMotion;
  const showFoam = clampedLevel > 0;
  const foamHeight = Math.min(FOAM_HEIGHT_PCT, clampedLevel);
  const liquidTop = 100 - clampedLevel;

  const containerClassName = [
    'liquid-fill',
    animated ? 'liquid-fill--pouring' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const bodyClassName = [
    'liquid-fill__body',
    reducedMotion ? '' : 'liquid-fill__body--transition',
  ].filter(Boolean).join(' ');

  const foamClassName = [
    'liquid-fill__foam',
    animated ? 'liquid-fill__foam--ripple' : '',
  ].filter(Boolean).join(' ');

  const containerStyle = {
    '--liquid-color': liquid,
    '--liquid-highlight': highlight,
  } as CSSProperties;

  return (
    <div
      className={containerClassName}
      style={containerStyle}
      data-testid="liquid-fill"
      data-pouring={pouring}
      data-reduced-motion={reducedMotion}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="liquid-fill__svg"
        aria-hidden="true"
      >
        <rect
          data-testid="liquid-fill-body"
          className={bodyClassName}
          x={0}
          y={liquidTop}
          width={100}
          height={clampedLevel}
          fill={liquid}
        />
        {showFoam && (
          <rect
            data-testid="liquid-fill-foam"
            className={foamClassName}
            x={0}
            y={liquidTop}
            width={100}
            height={foamHeight}
            fill={highlight}
          />
        )}
      </svg>
      {pouring && (
        <div className="liquid-fill__readout" data-testid="liquid-readout">
          {formatVolumeMl(curServMl ?? 0, units)}
        </div>
      )}
    </div>
  );
}
