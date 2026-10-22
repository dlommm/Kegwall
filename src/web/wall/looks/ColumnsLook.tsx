import { memo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import {
  MenuQr, levelColor, metaParts, servingsWord, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './ColumnsLook.module.css';

/** Columns (V2): each column is the keg, filled in the beer's color to its level. */
export const ColumnsLook = memo(function ColumnsLook(props: WallLookProps) {
  const {
    taps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId,
  } = props;
  const meta = useLookMeta(props, { tempLabel: '' });
  const models = useWallModels(taps, units, servingSizeMl);

  return (
    <div className={styles.look} data-look="columns" data-testid="look-columns">
      <header className={styles.header}>
        <h1 className={styles.brand}>{title}</h1>
        <span className={styles.meta} data-testid="look-meta">
          {metaParts(meta)}
        </span>
        {config.showQr && <MenuQr url={menuUrl} size={64} />}
      </header>
      <div className={styles.row} style={{ '--cols': Math.max(models.length, 4) } as CSSProperties}>
        {models.map((m) => {
          const level = m.isKicked || !m.hasBeer ? 0 : m.levelPct / 100;
          const liquid = levelColor(m.beerColor);
          const n = m.servings != null ? Math.max(0, Math.round(m.servings)) : null;
          return (
            <section
              key={m.tap.tapId}
              className={styles.col}
              data-testid="columns-col"
              data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
            >
              <div className={styles.lab}>
                <span className={styles.tapNo}>{`Tap ${m.tapNumber}`}</span>
                <h2 className={styles.name}>{m.name ?? 'Empty tap'}</h2>
                <span className={styles.style}>{m.style}</span>
                <span className={styles.abv}>{m.abv != null ? `${m.abv}%` : ''}</span>
                <span className={styles.figure}>
                  {m.isKicked ? 'Kicked' : n ?? '—'}
                  {!m.isKicked && n != null && <small>{`${servingsWord(m, n)} left`}</small>}
                </span>
              </div>
              <div className={styles.keg}>
                <i style={{ '--level': level, background: liquid } as CSSProperties} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
});
