import type { TakeoverViewProps } from './PourTakeover';
import { tapLookModel } from '../../lib/lookData';
import { srmToColor } from '../../lib/srm';
import { formatTempC } from '../../lib/units';
import { pourFraction, splitVolume } from './takeoverShared';

/**
 * Takeover 9c — "The Fill": the whole screen IS the glass. A full-bleed
 * liquid in the beer's real SRM hex rises from the bottom with the poured
 * fraction, a foam band (the SRM highlight color) tracking its surface. The
 * giant 220px counter and beer identity sit centered with dark text-shadows
 * so they stay legible over any liquid color (per the design).
 */
export function FillTakeover({ state, units, tempC }: TakeoverViewProps) {
  const m = tapLookModel(state.tap, units);
  const complete = state.phase === 'complete';
  const { value, unit } = splitVolume(state.pourMl, units);
  const { liquid, highlight } = srmToColor(m.srm);
  const heightPct = `${(pourFraction(state.pourMl) * 100).toFixed(1)}%`;

  return (
    <div className="takeover-fill" data-testid="takeover-fill">
      <div
        className="takeover-fill__liquid"
        style={{ height: heightPct, background: liquid }}
        data-testid="takeover-fill-liquid"
      />
      <div
        className="takeover-fill__foam"
        style={{ bottom: heightPct, background: highlight }}
      />
      <div className="takeover-fill__content">
        <span className="takeover-fill__now font-display">{`NOW POURING · TAP ${m.tapNumber}`}</span>
        <span className="takeover-fill__name font-display" data-testid="takeover-beer-name">{m.name}</span>
        <span className="takeover-fill__style">
          {[
            m.style,
            m.abv != null ? `${m.abv.toFixed(1)}%` : null,
            tempC != null ? formatTempC(tempC, units) : null,
          ].filter(Boolean).join(' · ')}
        </span>
        <div className="takeover-fill__counter" data-testid="takeover-counter">
          <span className="takeover-fill__counter-value font-display font-tabular">{value}</span>
          <span className="takeover-fill__counter-unit font-display">{unit}</span>
        </div>
        {complete && (
          <span className="takeover-fill__complete font-display" data-testid="takeover-complete">
            🍺 CHEERS — BACK TO THE WALL
          </span>
        )}
      </div>
    </div>
  );
}
