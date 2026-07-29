import type { WallLookProps } from './WallLook';
import { tapLookModel } from '../../lib/lookData';
import { SrmGlass } from '../glyphs/SrmGlass';
import {
  LookBadges, LookQr, SensorChips, useLookClock, withSpotlight,
} from './lookShared';

/**
 * Look 1b — "The Gallery": a 3-across card grid. Each card: style-matched
 * glass glyph left; TAP N + badges, name, style, ABV/IBU/kcal chips, optional
 * notes right; a keg status bar along the bottom with % left + servings +
 * poured. Header carries title/announcement, sensor chips, clock and the QR.
 * Layout per design option 1b; colors via theme tokens (`.gallery-*`).
 */
export function GalleryLook({
  taps, config, units, title, menuUrl, tempC, logoUrl, spotlightTapId, sensors,
}: WallLookProps) {
  const clock = useLookClock();
  const showNotes = config.fields.description !== false;

  return (
    <div className="gallery-look" data-testid="gallery-look">
      <header className="gallery-look__header">
        {logoUrl && <img src={logoUrl} alt="" className="gallery-look__logo" />}
        <div className="gallery-look__identity">
          <span className="gallery-look__title font-display">{title}</span>
          {config.header.subtitle && (
            <span className="gallery-look__subtitle">{config.header.subtitle}</span>
          )}
        </div>
        <div className="gallery-look__spacer" />
        {config.header.showTemp && <SensorChips tempC={tempC} units={units} sensors={sensors} />}
        {config.header.showClock && (
          <span className="gallery-look__clock font-display font-tabular" data-testid="look-clock">{clock}</span>
        )}
        {config.showQr && <LookQr url={menuUrl} label="Menu" />}
      </header>

      <div className="gallery-look__grid">
        {taps.map((tap) => {
          const m = tapLookModel(tap, units);
          if (!m.hasBeer) {
            return (
              <div key={tap.tapId} className="gallery-card gallery-card--empty" data-testid="gallery-card-empty">
                <p className="gallery-card__empty-text">{`Tap ${m.tapNumber} — nothing on tap`}</p>
              </div>
            );
          }
          return (
            <div
              key={tap.tapId}
              className={`${withSpotlight('gallery-card', tap.tapId, spotlightTapId)}${m.isKicked ? ' gallery-card--kicked' : ''}`}
              data-testid="gallery-card"
            >
              <div className="gallery-card__body">
                <div className="gallery-card__glass">
                  <SrmGlass srm={m.srm} style={m.style} width={80} mode={config.glyphMode} />
                  {m.srmLabel && <span className="gallery-card__srm font-tabular">{`${m.srmLabel} SRM`}</span>}
                </div>
                <div className="gallery-card__info">
                  <div className="gallery-card__tap-line">
                    <span className="gallery-card__tap-label">{`TAP ${m.tapNumber}`}</span>
                    {m.isKicked && <span className="look-badge look-badge--kicked">KICKED</span>}
                    <LookBadges model={m} />
                  </div>
                  <span className="gallery-card__name font-display" data-testid="gallery-card-name">{m.name}</span>
                  {m.style && (
                    <span className="gallery-card__style">
                      {m.style}
                      {m.avgRating != null && (
                        <span className="font-tabular" data-testid="look-rating">{` · ★ ${m.avgRating.toFixed(1)}`}</span>
                      )}
                    </span>
                  )}
                  <div className="gallery-card__chips">
                    {m.abv != null && <span className="gallery-card__chip font-tabular">{`${m.abv.toFixed(1)}% ABV`}</span>}
                    {m.ibu != null && <span className="gallery-card__chip font-tabular">{`${m.ibu} IBU`}</span>}
                    {m.kcal != null && <span className="gallery-card__chip font-tabular">{`${m.kcal} kcal`}</span>}
                  </div>
                  {showNotes && m.notes && <span className="gallery-card__notes">{m.notes}</span>}
                </div>
              </div>
              <div className="gallery-card__status">
                <div className="gallery-card__bar">
                  <div
                    className={`gallery-card__bar-fill gallery-card__bar-fill--${m.status}`}
                    style={{ width: `${m.levelPct}%` }}
                    data-testid="gallery-card-bar"
                  />
                </div>
                <div className="gallery-card__status-line font-tabular">
                  <span data-testid="gallery-card-remaining">
                    {`${m.levelPct}% left`}
                    {m.servingsLeft != null ? ` · ≈ ${m.servingsLeft} ${m.servingsNoun}` : ''}
                  </span>
                  {m.pouredLabel && <span>{`${m.pouredLabel} poured`}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
