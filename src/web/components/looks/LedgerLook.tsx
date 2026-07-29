import type { WallLookProps } from './WallLook';
import { tapLookModel } from '../../lib/lookData';
import { SrmGlass } from '../glyphs/SrmGlass';
import { HopFill } from '../glyphs/HopFill';
import { AbvGlasses } from '../glyphs/AbvGlasses';
import { KegSilhouette } from '../glyphs/KegSilhouette';
import {
  LookBadges, LookQr, SensorChips, TickerMarquee, useLookClock,
} from './lookShared';

/**
 * Look 1a — "The Ledger": one row per tap. Columns: tap number circle |
 * gravity/color cell (OG · glass glyph · SRM) | bitterness cell (BU:GU · hop
 * glyph · IBU) | name + badges + style/brewery + notes | calories cell (kcal ·
 * ABV mini-glasses · ABV%) | poured/remaining + keg silhouette. 94px header
 * (logo, title, announcement, sensor chips, clock), 46px footer (marquee
 * ticker + QR). Layout/values per the design doc's option 1a; all colors via
 * theme tokens (see index.css `.ledger-*`).
 */
export function LedgerLook({
  taps, config, units, title, menuUrl, tempC, logoUrl,
}: WallLookProps) {
  const clock = useLookClock();
  const showNotes = config.fields.description !== false;
  const glyphMode = config.glyphMode;

  return (
    <div className="ledger-look" data-testid="ledger-look">
      <header className="ledger-look__header">
        {logoUrl && <img src={logoUrl} alt="" className="ledger-look__logo" />}
        <div className="ledger-look__identity">
          <span className="ledger-look__title font-display">{title}</span>
          {config.header.subtitle && (
            <span className="ledger-look__subtitle">{config.header.subtitle}</span>
          )}
        </div>
        <div className="ledger-look__spacer" />
        <div className="ledger-look__meta">
          {config.header.showTemp && <SensorChips tempC={tempC} units={units} />}
          {config.header.showClock && (
            <span className="ledger-look__clock font-display font-tabular" data-testid="look-clock">{clock}</span>
          )}
        </div>
      </header>

      <div className="ledger-look__rows">
        {taps.map((tap) => {
          const m = tapLookModel(tap, units);
          if (!m.hasBeer) {
            return (
              <div key={tap.tapId} className="ledger-row ledger-row--empty" data-testid="ledger-row-empty">
                <div className="ledger-row__tapnum font-display">{m.tapNumber}</div>
                <p className="ledger-row__empty-text">{`Tap ${m.tapNumber} — nothing on tap`}</p>
              </div>
            );
          }
          return (
            <div key={tap.tapId} className={`ledger-row${m.isKicked ? ' ledger-row--kicked' : ''}`} data-testid="ledger-row">
              <div className="ledger-row__tapnum font-display">{m.tapNumber}</div>

              <div className="ledger-row__cell">
                {m.ogLabel && <span className="ledger-row__cell-top font-tabular">{`${m.ogLabel} OG`}</span>}
                <SrmGlass srm={m.srm} style={m.style} width={58} mode={glyphMode} />
                {m.srmLabel && <span className="ledger-row__cell-bottom font-tabular">{`${m.srmLabel} SRM`}</span>}
              </div>

              <div className="ledger-row__cell">
                {m.buGuLabel && <span className="ledger-row__cell-top font-tabular">{`${m.buGuLabel} BU:GU`}</span>}
                <HopFill ibu={m.ibu} width={50} mode={glyphMode} />
                {m.ibu != null && <span className="ledger-row__cell-bottom font-tabular">{`${m.ibu} IBU`}</span>}
              </div>

              <div className="ledger-row__main">
                <div className="ledger-row__name-line">
                  <span className="ledger-row__name font-display" data-testid="ledger-row-name">{m.name}</span>
                  {m.isKicked && <span className="look-badge look-badge--kicked">KICKED</span>}
                  <LookBadges model={m} newLabel="NEW ON TAP" />
                </div>
                <span className="ledger-row__style">
                  {[m.style, m.brewery].filter(Boolean).join(' · ')}
                </span>
                {showNotes && m.notes && <span className="ledger-row__notes">{m.notes}</span>}
              </div>

              <div className="ledger-row__cell">
                {m.kcal != null && <span className="ledger-row__cell-top font-tabular">{`${m.kcal} kcal / 12 oz`}</span>}
                <AbvGlasses abv={m.abv} srm={m.srm} />
                {m.abv != null && <span className="ledger-row__abv font-tabular">{`${m.abv.toFixed(1)}% ABV`}</span>}
              </div>

              <div className="ledger-row__level">
                <div className="ledger-row__level-figures">
                  {m.pouredLabel && <span className="ledger-row__level-dim font-tabular">{`${m.pouredLabel} poured`}</span>}
                  <span className="ledger-row__level-main font-tabular" data-testid="ledger-row-remaining">
                    {`${m.remainingLabel} · ${m.levelPct}% left`}
                  </span>
                  {m.servingsLeft != null && (
                    <span className="ledger-row__level-dim font-tabular">{`≈ ${m.servingsLeft} ${m.servingsNoun}`}</span>
                  )}
                </div>
                <KegSilhouette levelPct={m.levelPct} kegType={m.kegType} width={62} />
              </div>
            </div>
          );
        })}
      </div>

      <footer className="ledger-look__footer">
        {config.ticker ? <TickerMarquee text={config.ticker} /> : <div className="ledger-look__footer-spacer" />}
        {config.showQr && (
          <div className="ledger-look__qr">
            <LookQr url={menuUrl} />
          </div>
        )}
      </footer>
    </div>
  );
}
