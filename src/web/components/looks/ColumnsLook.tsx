import type { CSSProperties } from 'react';
import type { WallLookProps } from './WallLook';
import { tapLookModel } from '../../lib/lookData';
import { SrmGlass } from '../glyphs/SrmGlass';
import { HopFill } from '../glyphs/HopFill';
import { KegSilhouette } from '../glyphs/KegSilhouette';
import {
  LookBadges, SensorChips, useLookClock, withSpotlight,
} from './lookShared';

/**
 * Look 1c — "Tap Columns": one vertical column per tap (reads like a row of
 * real tap handles). Each column stacks TAP N, the big glass glyph, badges,
 * name, style, the ABV/IBU/kcal figures line, then hop + keg mini-glyphs with
 * their readouts and the ≈servings line. Footer shows page-cycle dots when the
 * wall rotates through more taps than fit. Per design option 1c; colors via
 * theme tokens (`.columns-*`).
 */
export function ColumnsLook({
  taps, config, units, title, tempC, pageIndex, pageCount, rotationSeconds, spotlightTapId, sensors,
}: WallLookProps) {
  const clock = useLookClock();
  const style = { '--look-cols': Math.max(1, taps.length) } as CSSProperties;

  return (
    <div className="columns-look" data-testid="columns-look">
      <header className="columns-look__header">
        {config.header.subtitle && (
          <span className="columns-look__subtitle">{config.header.subtitle}</span>
        )}
        <div className="columns-look__spacer" />
        <span className="columns-look__title font-display">{title}</span>
        <div className="columns-look__spacer" />
        {config.header.showTemp && <SensorChips tempC={tempC} units={units} sensors={sensors} />}
        {config.header.showClock && (
          <span className="columns-look__clock font-display font-tabular" data-testid="look-clock">{clock}</span>
        )}
      </header>

      <div className="columns-look__grid" style={style}>
        {taps.map((tap) => {
          const m = tapLookModel(tap, units);
          if (!m.hasBeer) {
            return (
              <div key={tap.tapId} className="columns-col columns-col--empty" data-testid="columns-col-empty">
                <span className="columns-col__tap-label">{`TAP ${m.tapNumber}`}</span>
                <p className="columns-col__empty-text">Nothing on tap</p>
              </div>
            );
          }
          return (
            <div
              key={tap.tapId}
              className={`${withSpotlight('columns-col', tap.tapId, spotlightTapId)}${m.isKicked ? ' columns-col--kicked' : ''}`}
              data-testid="columns-col"
            >
              <span className="columns-col__tap-label">{`TAP ${m.tapNumber}`}</span>
              <SrmGlass srm={m.srm} style={m.style} width={100} mode={config.glyphMode} />
              <div className="columns-col__badges">
                {m.isKicked && <span className="look-badge look-badge--kicked">KICKED</span>}
                <LookBadges model={m} lowLabel="LOW" />
              </div>
              <span className="columns-col__name font-display" data-testid="columns-col-name">{m.name}</span>
              {m.style && <span className="columns-col__style">{m.style}</span>}
              <span className="columns-col__figures font-tabular">
                {[
                  m.abv != null ? `${m.abv.toFixed(1)}%` : null,
                  m.ibu != null ? `${m.ibu} IBU` : null,
                  m.kcal != null ? `${m.kcal} kcal` : null,
                ].filter(Boolean).join(' · ')}
              </span>
              <div className="columns-col__glyphs">
                <div className="columns-col__glyph">
                  <HopFill ibu={m.ibu} width={42} mode={config.glyphMode} />
                  {m.buGuLabel && <span className="columns-col__glyph-label font-tabular">{`${m.buGuLabel} BU:GU`}</span>}
                </div>
                <div className="columns-col__glyph">
                  <KegSilhouette levelPct={m.levelPct} kegType={m.kegType} width={46} />
                  <span className="columns-col__glyph-label font-tabular" data-testid="columns-col-remaining">
                    {`${m.levelPct}% left`}
                  </span>
                </div>
              </div>
              {m.servingsLeft != null && (
                <span className="columns-col__servings font-tabular">{`≈ ${m.servingsLeft} ${m.servingsNoun}`}</span>
              )}
            </div>
          );
        })}
      </div>

      <footer className="columns-look__footer">
        {pageCount > 1 && (
          <div className="columns-look__dots" data-testid="columns-look-dots">
            {Array.from({ length: pageCount }, (_, i) => (
              <span
                // eslint-disable-next-line react/no-array-index-key -- dots are positional
                key={i}
                className={i === pageIndex ? 'columns-look__dot columns-look__dot--active' : 'columns-look__dot'}
              />
            ))}
            <span className="columns-look__page-label font-tabular">
              {`PAGE ${pageIndex + 1} OF ${pageCount} — NEXT IN ${rotationSeconds}s`}
            </span>
          </div>
        )}
      </footer>
    </div>
  );
}
