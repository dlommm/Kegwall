import type { WallLookProps } from './WallLook';
import { tapLookModel, type TapLookModel } from '../../lib/lookData';
import { srmToColor } from '../../lib/srm';
import { SrmGlass } from '../glyphs/SrmGlass';
import {
  LookBadges, LookPageDots, useLookClock, withSpotlight,
} from './lookShared';

/**
 * The design turn-8 look library (8a–8g): seven complete wall styles, each
 * rendering the same tap facts "in its own voice". Colors read through theme
 * tokens; a look's typography (Caveat, Playfair, Plex Mono) is part of the
 * look itself, per the design. Every look shows % remaining and renders
 * badges/pour state + page cycling in its own idiom (design rule).
 */

/** Poster (8e): ink color auto black/white by the row's SRM luminance — the
 * exact formula the design document's logic class uses. */
export function posterInk(srmHex: string): string {
  const r = parseInt(srmHex.slice(1, 3), 16);
  const g = parseInt(srmHex.slice(3, 5), 16);
  return r * 0.4 + g * 0.5 > 110 ? '#14100B' : '#F3EAD9';
}

/** Terminal (8d): `[██████░░░░]` ASCII level bar. */
export function asciiBar(levelPct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(levelPct / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function models(taps: WallLookProps['taps'], units: WallLookProps['units']): TapLookModel[] {
  return taps.map((tap) => tapLookModel(tap, units));
}

/** 8a — Chalkboard: hand-lettered pub menu, chalk-outline glassware, dashed
 * dividers, dotted price-leader lines, 2-column menu. */
export function ChalkboardLook({
  taps, config, units, title, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  const clock = useLookClock();
  return (
    <div className="chalk-look" data-testid="chalkboard-look">
      <header className="chalk-look__header">
        <span className="chalk-look__title">{title}</span>
        <span className="chalk-look__sub">
          {`— ON TAP TONIGHT${config.header.showClock ? ` · ${clock}` : ''} —`}
        </span>
      </header>
      <div className="chalk-look__menu">
        {models(taps, units).map((m) => (
          <div key={m.tap.tapId} className={withSpotlight('chalk-row', m.tap.tapId, spotlightTapId)} data-testid="chalk-row">
            <SrmGlass srm={m.srm} style={m.style} width={64} mode="outline" />
            <div className="chalk-row__main">
              <div className="chalk-row__name-line">
                <span className="chalk-row__name">{m.name ?? `Tap ${m.tapNumber}`}</span>
                <span className="chalk-row__leader" aria-hidden="true" />
                {m.abv != null && <span className="chalk-row__abv font-tabular">{`${m.abv.toFixed(1)}%`}</span>}
              </div>
              <span className="chalk-row__meta font-tabular">
                {[`No. ${m.tapNumber}`, m.style, m.ibu != null ? `${m.ibu} IBU` : null, `${m.levelPct}% left`]
                  .filter(Boolean).join(' · ')}
                {' '}
                <LookBadges model={m} />
              </span>
            </div>
          </div>
        ))}
      </div>
      <footer className="chalk-look__footer">
        {config.ticker && <span className="chalk-look__ticker">{config.ticker}</span>}
        <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
      </footer>
    </div>
  );
}

/** 8b — Editorial: quiet magazine typography — numbered 01–06, big italic
 * serif names, a notes column, thin level bar + "P% REMAINS". */
export function EditorialLook({
  taps, config, units, title, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  const clock = useLookClock();
  const dateLabel = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' }).toUpperCase();
  return (
    <div className="editorial-look" data-testid="editorial-look">
      <header className="editorial-look__header">
        <span className="editorial-look__title">{title}</span>
        <span className="editorial-look__sub font-tabular">
          {`TAP LIST · ${dateLabel}${config.header.showClock ? ` · ${clock}` : ''}`}
        </span>
      </header>
      <div className="editorial-look__rows">
        {models(taps, units).map((m) => (
          <div key={m.tap.tapId} className={withSpotlight('editorial-row', m.tap.tapId, spotlightTapId)} data-testid="editorial-row">
            <span className="editorial-row__num font-tabular">{String(m.tapNumber).padStart(2, '0')}</span>
            <div className="editorial-row__main">
              <span className="editorial-row__name">{m.name ?? '—'}</span>
              <span className="editorial-row__style">
                {[m.style, m.brewery].filter(Boolean).join(' — ')}
                {' '}
                <LookBadges model={m} />
              </span>
            </div>
            <span className="editorial-row__notes">{config.fields.description !== false ? m.notes : null}</span>
            <div className="editorial-row__figures">
              <span className="editorial-row__specs font-tabular">
                {m.abv != null && <b>{`${m.abv.toFixed(1)}%`}</b>}
                {m.ibu != null && ` · ${m.ibu} IBU`}
                {m.srm != null && (
                  <>
                    {' · '}
                    <span className="editorial-row__srm-dot" style={{ backgroundColor: srmToColor(m.srm).liquid }} aria-hidden="true" />
                    {` ${m.srmLabel}`}
                  </>
                )}
              </span>
              <div className="editorial-row__bar">
                <div className="editorial-row__bar-fill" style={{ width: `${m.levelPct}%` }} />
              </div>
              <span className="editorial-row__remains font-tabular" data-testid="editorial-remains">
                {`${m.levelPct}% REMAINS`}
              </span>
            </div>
          </div>
        ))}
      </div>
      <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
    </div>
  );
}

/** 8c — Neon arcade: glow strokes, gradient level bars, big ABV. */
export function NeonLook({
  taps, config, units, title, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  const clock = useLookClock();
  return (
    <div className="neon-look" data-testid="neon-look">
      <header className="neon-look__header">
        <span className="neon-look__title font-display">{title.toUpperCase()}</span>
        {config.header.showClock && <span className="neon-look__clock font-display font-tabular">{clock}</span>}
      </header>
      <div className="neon-look__grid">
        {models(taps, units).map((m) => (
          <div key={m.tap.tapId} className={withSpotlight('neon-card', m.tap.tapId, spotlightTapId)} data-testid="neon-card">
            <span className="neon-card__num font-display font-tabular">{m.tapNumber}</span>
            <div className="neon-card__main">
              <span className="neon-card__name font-display">{m.name ?? '—'}</span>
              <span className="neon-card__meta font-tabular">
                {[m.style, m.ibu != null ? `${m.ibu} IBU` : null, `${m.levelPct}% left`].filter(Boolean).join(' · ')}
                {' '}
                <LookBadges model={m} />
              </span>
              <div className="neon-card__bar">
                <div className="neon-card__bar-fill" style={{ width: `${m.levelPct}%` }} />
              </div>
            </div>
            {m.abv != null && <span className="neon-card__abv font-display font-tabular">{`${m.abv.toFixed(1)}%`}</span>}
          </div>
        ))}
      </div>
      <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
    </div>
  );
}

/** 8d — Terminal: green phosphor, monospace, ASCII level bars, box-drawing frame. */
export function TerminalLook({
  taps, config, units, title, tempC, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  const clock = useLookClock();
  const tempLabel = tempC != null ? ` ─ keg_room: ${((tempC * 9) / 5 + 32).toFixed(1)}F` : '';
  return (
    <div className="terminal-look" data-testid="terminal-look">
      <span className="terminal-look__frame">
        {`┌─[ ${title.toUpperCase().replace(/\s+/g, '.')}.TAPS ]${'─'.repeat(8)}${config.header.showClock ? ` ${clock} ` : ' '}${tempLabel} ─┐`}
      </span>
      <div className="terminal-look__rows">
        {models(taps, units).map((m) => (
          <div key={m.tap.tapId} className={withSpotlight('terminal-row', m.tap.tapId, spotlightTapId)} data-testid="terminal-row">
            <div className="terminal-row__name-line">
              <span className="terminal-row__prompt">{`tap${String(m.tapNumber).padStart(2, '0')} >`}</span>
              <span className="terminal-row__name">{m.name ?? '(empty)'}</span>
              {m.style && <span className="terminal-row__style">{`// ${m.style}`}</span>}
              <LookBadges model={m} lowLabel="LOW" />
            </div>
            <div className="terminal-row__stats font-tabular">
              {m.abv != null && <span>{`abv=${m.abv.toFixed(1)}%`}</span>}
              {m.ibu != null && <span>{`ibu=${m.ibu}`}</span>}
              {m.srmLabel && <span>{`srm=${m.srmLabel}`}</span>}
              {m.ogLabel && <span>{`og=${m.ogLabel}`}</span>}
              <span className="terminal-row__bar" data-testid="terminal-bar">{`[${asciiBar(m.levelPct)}]`}</span>
              <span data-testid="terminal-pct">{`${m.levelPct}%`}</span>
              {m.servingsLeft != null && <span className="terminal-row__dim">{`${m.servingsLeft} ${m.servingsNoun}_left`}</span>}
            </div>
          </div>
        ))}
      </div>
      <span className="terminal-look__frame">
        {`└─${config.ticker ? ` ${config.ticker} ` : ''}${'─'.repeat(24)}┘`}
      </span>
      <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
    </div>
  );
}

/** 8e — Poster: brutalist — each row's background IS the beer's real SRM hex,
 * ink flips black/white by luminance, 76px names. */
export function PosterLook({
  taps, units, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  return (
    <div className="poster-look" data-testid="poster-look">
      {models(taps, units).map((m) => {
        const srmHex = srmToColor(m.srm).liquid;
        const ink = posterInk(srmHex);
        return (
          <div
            key={m.tap.tapId}
            className={withSpotlight('poster-row', m.tap.tapId, spotlightTapId)}
            style={{ backgroundColor: m.hasBeer ? srmHex : 'transparent', color: m.hasBeer ? ink : 'var(--text-dim)' }}
            data-testid="poster-row"
          >
            <span className="poster-row__num font-display font-tabular">{m.tapNumber}</span>
            <span className="poster-row__name font-display">{(m.name ?? 'EMPTY').toUpperCase()}</span>
            {m.style && <span className="poster-row__style">{m.style}</span>}
            <span className="poster-row__spacer" />
            <LookBadges model={m} />
            <span className="poster-row__specs font-tabular" data-testid="poster-specs">
              {[
                m.abv != null ? `${m.abv.toFixed(1)}%` : null,
                m.ibu != null ? `${m.ibu} IBU` : null,
                `${m.levelPct}%▮`,
              ].filter(Boolean).join(' · ')}
            </span>
          </div>
        );
      })}
      <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
    </div>
  );
}

/** 8f — Departures: split-flap board — TAP/BEER/STYLE/ABV/FULL/STATUS with
 * POURING (pulsing) / LOW / ON TIME. */
export function DeparturesLook({
  taps, config, units, title, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  const clock = useLookClock();
  return (
    <div className="departures-look" data-testid="departures-look">
      <header className="departures-look__header">
        <span className="departures-look__title">{`${title.toUpperCase()} · DEPARTURES`}</span>
        {config.header.showClock && <span className="departures-look__clock font-tabular">{clock}</span>}
      </header>
      <div className="departures-look__cols" aria-hidden="true">
        <span>TAP</span><span>BEER</span><span>STYLE</span><span>ABV</span><span>FULL</span><span>STATUS</span>
      </div>
      <div className="departures-look__rows">
        {models(taps, units).map((m) => (
          <div key={m.tap.tapId} className={withSpotlight('departures-row', m.tap.tapId, spotlightTapId)} data-testid="departures-row">
            <span className="font-tabular">{String(m.tapNumber).padStart(2, '0')}</span>
            <span className="departures-row__name">{(m.name ?? 'EMPTY').toUpperCase()}</span>
            <span className="departures-row__style">{(m.style ?? '').toUpperCase()}</span>
            <span className="font-tabular">{m.abv != null ? `${m.abv.toFixed(1)}%` : '—'}</span>
            <span className="font-tabular" data-testid="departures-full">{`${m.levelPct}%`}</span>
            <span
              className={`departures-row__status${m.pouring ? ' departures-row__status--pouring' : m.isLow ? ' departures-row__status--low' : ''}`}
              data-testid="departures-status"
            >
              {m.pouring ? '● POURING' : m.isLow ? '▲ LOW' : m.isKicked ? '✕ KICKED' : 'ON TIME'}
            </span>
          </div>
        ))}
      </div>
      <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
    </div>
  );
}

/** 8g — Zen: radical minimal — SRM dot, name, style, ABV, a 120px hairline of
 * level and a small %. Nothing else. */
export function ZenLook({
  taps, units, title, pageIndex, pageCount, spotlightTapId,
}: WallLookProps) {
  const count = taps.length;
  const countWord = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'][count] ?? String(count);
  return (
    <div className="zen-look" data-testid="zen-look">
      <span className="zen-look__eyebrow">{`${title.toUpperCase()} — ${countWord} ON TAP`}</span>
      <div className="zen-look__rows">
        {models(taps, units).map((m) => (
          <div key={m.tap.tapId} className={withSpotlight('zen-row', m.tap.tapId, spotlightTapId)} data-testid="zen-row">
            <span
              className="zen-row__dot"
              style={{ backgroundColor: m.hasBeer ? srmToColor(m.srm).liquid : 'transparent' }}
              aria-hidden="true"
            />
            <span className="zen-row__name">{m.name ?? `Tap ${m.tapNumber}`}</span>
            <span className="zen-row__style">{m.style ?? ''}</span>
            <LookBadges model={m} />
            <span className="zen-row__spacer" />
            {m.abv != null && <span className="zen-row__abv font-tabular">{`${m.abv.toFixed(1)}%`}</span>}
            <div className="zen-row__bar">
              <div className="zen-row__bar-fill" style={{ width: `${m.levelPct}%` }} />
            </div>
            <span className="zen-row__pct font-tabular" data-testid="zen-pct">{`${m.levelPct}%`}</span>
          </div>
        ))}
      </div>
      <LookPageDots pageIndex={pageIndex} pageCount={pageCount} />
    </div>
  );
}
