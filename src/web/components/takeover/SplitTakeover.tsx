import type { TakeoverViewProps } from './PourTakeover';
import { tapLookModel } from '../../lib/lookData';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { pourFraction, splitVolume } from './takeoverShared';

/**
 * Takeover 9a — "Split": the wall squeezes left (dimmed — see WallPage's
 * `takeover-squeeze` class on the content wrapper) while a 640px inverted
 * panel takes the right edge: NOW POURING label, beer name, style · ABV, the
 * big counter, and a progress hairline. "Inverted" = the theme's text color
 * becomes the panel background and vice versa, so it reads as the wall's own
 * negative space on every theme.
 */
export function SplitTakeover({ state, units }: TakeoverViewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const m = tapLookModel(state.tap, units);
  const complete = state.phase === 'complete';
  const { value, unit } = splitVolume(state.pourMl, units);
  const frac = pourFraction(state.pourMl);

  return (
    <div className="takeover-split" data-testid="takeover-split">
      <span className="takeover-split__now">
        <span className={reducedMotion ? 'look-pour-dot' : 'look-pour-dot look-pour-dot--pulse'} />
        {`NOW POURING · TAP ${m.tapNumber}`}
      </span>
      <span className="takeover-split__name font-display" data-testid="takeover-beer-name">{m.name}</span>
      <span className="takeover-split__style">
        {[m.style, m.abv != null ? `${m.abv.toFixed(1)}%` : null].filter(Boolean).join(' · ')}
      </span>
      <div className="takeover-split__counter" data-testid="takeover-counter">
        <span className="takeover-split__counter-value font-display font-tabular">{value}</span>
        <span className="takeover-split__counter-unit font-display">{unit.toLowerCase()}</span>
      </div>
      <div className="takeover-split__progress">
        <div className="takeover-split__progress-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
      <span className="takeover-split__note" data-testid={complete ? 'takeover-complete' : 'takeover-active-note'}>
        {complete ? '— a fine pour. cheers —' : 'panel closes when the tap shuts'}
      </span>
    </div>
  );
}
