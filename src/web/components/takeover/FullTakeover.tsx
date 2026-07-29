import type { TakeoverViewProps } from './PourTakeover';
import { tapLookModel } from '../../lib/lookData';
import { formatTempC } from '../../lib/units';
import { SrmGlass } from '../glyphs/SrmGlass';
import { KegSilhouette } from '../glyphs/KegSilhouette';
import { useLookClock } from '../looks/lookShared';
import { pourFraction, splitVolume } from './takeoverShared';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';

/**
 * Takeover 2a — "Full": the whole screen becomes a Now Pouring moment. Left:
 * beer name (96px), style/brewery, spec chips, the giant live counter (190px,
 * accent) and the keg-remaining readout. Right: a pour stream feeding a big
 * style-matched glass that fills with the real poured fraction. On complete,
 * a full-screen splash with the final volume.
 */
export function FullTakeover({
  state, units, tempC,
}: TakeoverViewProps) {
  const clock = useLookClock();
  const reducedMotion = usePrefersReducedMotion();
  const m = tapLookModel(state.tap, units);
  const complete = state.phase === 'complete';
  const { value, unit } = splitVolume(state.pourMl, units);
  const frac = pourFraction(state.pourMl);

  return (
    <div className="takeover-full" data-testid="takeover-full">
      <header className="takeover-full__header">
        <span className="takeover-full__now font-display">
          <span className={reducedMotion ? 'look-pour-dot' : 'look-pour-dot look-pour-dot--pulse'} />
          {`NOW POURING · TAP ${m.tapNumber}`}
        </span>
        <span className="takeover-full__clock font-display font-tabular">{clock}</span>
      </header>
      <div className="takeover-full__body">
        <div className="takeover-full__facts">
          <span className="takeover-full__name font-display" data-testid="takeover-beer-name">{m.name}</span>
          <span className="takeover-full__style">
            {[m.style, m.brewery].filter(Boolean).join(' · ')}
          </span>
          <div className="takeover-full__chips">
            {m.abv != null && <span className="takeover-full__chip font-tabular">{`${m.abv.toFixed(1)}% ABV`}</span>}
            {m.ibu != null && <span className="takeover-full__chip font-tabular">{`${m.ibu} IBU`}</span>}
            {m.kcal != null && <span className="takeover-full__chip font-tabular">{`${m.kcal} kcal / 12 oz`}</span>}
            {tempC != null && (
              <span className="takeover-full__chip takeover-full__chip--dim font-tabular">
                {`Kegtron ${formatTempC(tempC, units)}`}
              </span>
            )}
          </div>
          <div className="takeover-full__counter" data-testid="takeover-counter">
            <span className="takeover-full__counter-value font-display font-tabular">{value}</span>
            <span className="takeover-full__counter-unit font-display">{unit}</span>
          </div>
          <div className="takeover-full__keg">
            <KegSilhouette levelPct={m.levelPct} kegType={m.kegType} width={62} />
            <div className="takeover-full__keg-figures">
              <span className="takeover-full__keg-left font-tabular">{`${m.remainingLabel} left in keg`}</span>
              {m.servingsLeft != null && (
                <span className="takeover-full__keg-dim font-tabular">
                  {`≈ ${m.servingsLeft} ${m.servingsNoun} · returns to the wall when the pour ends`}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="takeover-full__glass">
          {!complete && <div className="takeover-full__stream" data-testid="takeover-stream" />}
          <SrmGlass
            srm={m.srm}
            style={m.style}
            width={280}
            fill={0.06 + frac * 0.82}
          />
        </div>
      </div>
      {complete && (
        <div className="takeover-full__complete" data-testid="takeover-complete">
          <span className="takeover-full__complete-label font-display">POUR COMPLETE</span>
          <span className="takeover-full__complete-volume font-display font-tabular">{`${value} ${unit}`}</span>
          <span className="takeover-full__complete-note">
            {`${m.name} · Tap ${m.tapNumber} — cheers! Scan the QR to claim this pour.`}
          </span>
        </div>
      )}
    </div>
  );
}
