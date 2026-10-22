import { memo, type CSSProperties } from 'react';
import '@fontsource-variable/anybody/standard.css';
import type { WallLookProps } from '../../components/looks/WallLook';
import { ensureContrast } from '../../lib/contrast';
import { wallHeadline } from '../headline';
import {
  MenuQr, levelColor, metaParts, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './HandlesLook.module.css';

/** Handle name size: long names step down so four lines still fit the handle. */
export function handleNameSize(name: string): number {
  return name.length > 22 ? 34 : name.length > 14 ? 40 : 46;
}

/**
 * Tap Handles (V2, new): the bar back. Each tap is a handle in its beer's color with a framed
 * sight glass showing the keg's level and the pints left; the pouring handle tips forward like
 * a pulled tap. The drip tray along the bottom carries the wall's sentence headline.
 */
export const HandlesLook = memo(function HandlesLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId,
  } = props;
  const meta = useLookMeta(props, { tempLabel: '' });
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const headline = wallHeadline(wall, units);

  return (
    <div className={styles.look} data-look="handles" data-testid="look-handles">
      <header className={styles.header}>
        <h1 className={styles.brand}>{title}</h1>
        <span className={styles.meta} data-testid="look-meta">{metaParts(meta)}</span>
      </header>
      <div className={styles.row} style={{ '--cols': Math.max(models.length, 6) } as CSSProperties}>
        {models.map((m) => {
          const kicked = m.isKicked || !m.hasBeer;
          const body = kicked ? '#2A2723' : m.beerColor;
          const ink = kicked ? '#B3ACA1' : m.markerInk;
          const low = ensureContrast(ink === '#FFFFFF' ? '#FFC35A' : '#7A2E00', [body], ink, 4.5) ?? ink;
          const n = m.servings != null ? Math.max(0, Math.round(m.servings)) : null;
          return (
            <div
              key={m.tap.tapId}
              className={styles.handle}
              data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
              style={{ '--body': body, '--ink': ink, '--low': low, '--beer': levelColor(m.beerColor) } as CSSProperties}
            >
              <div className={styles.body}>
                <span className={styles.tapNo}>{`Tap ${m.tapNumber}`}</span>
                <h2 className={styles.name} style={{ '--name-size': handleNameSize(m.name ?? '') } as CSSProperties}>
                  {m.name ?? 'Empty'}
                </h2>
                <span className={styles.small}>{m.style}</span>
                <span className={styles.small}>{m.brewery}</span>
                <span className={styles.abv}>{m.abv != null ? `${m.abv}%` : ''}</span>
                <span className={styles.small}>{m.ibu != null ? `${m.ibu} IBU` : ' '}</span>
                <div className={styles.glass}><i style={{ '--level': kicked ? 0 : m.levelPct / 100 } as CSSProperties} /></div>
                <span className={styles.left}>
                  {m.pouring && m.pourLabel ? `Pouring · ${m.pourLabel}` : m.isKicked ? 'Kicked' : n != null ? `${n} ${m.servingNoun}${n === 1 ? '' : 's'} left` : 'No keg'}
                </span>
              </div>
              <div className={styles.ferrule} />
              <div className={styles.shank} />
            </div>
          );
        })}
      </div>
      <footer className={styles.tray}>
        <p>{headline.detail ? `${headline.lead} ${headline.detail}` : headline.lead}</p>
        {config.showQr && <MenuQr url={menuUrl} size={64} />}
      </footer>
    </div>
  );
});
