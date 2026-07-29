import type { TakeoverViewProps } from './PourTakeover';
import { tapLookModel } from '../../lib/lookData';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { pourFraction, splitVolume } from './takeoverShared';

/**
 * Takeover 9b — "Dock": the least disruptive style. The wall never moves; a
 * 110px bar docks along the bottom with a pulsing dot, "Tap N · Beer", a
 * progress bar, the big live counter, and a COMPLETE ✓ chip at the end.
 */
export function DockTakeover({ state, units }: TakeoverViewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const m = tapLookModel(state.tap, units);
  const complete = state.phase === 'complete';
  const { value, unit } = splitVolume(state.pourMl, units);
  const frac = pourFraction(state.pourMl);

  return (
    <div className="takeover-dock" data-testid="takeover-dock">
      <span className={reducedMotion ? 'look-pour-dot takeover-dock__dot' : 'look-pour-dot look-pour-dot--pulse takeover-dock__dot'} />
      <span className="takeover-dock__label font-display" data-testid="takeover-beer-name">
        {`Tap ${m.tapNumber} · ${m.name}`}
      </span>
      <div className="takeover-dock__progress">
        <div className="takeover-dock__progress-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
      <span className="takeover-dock__counter font-display font-tabular" data-testid="takeover-counter">
        {`${value} ${unit}`}
      </span>
      {complete && (
        <span className="takeover-dock__complete font-display" data-testid="takeover-complete">COMPLETE ✓</span>
      )}
    </div>
  );
}
