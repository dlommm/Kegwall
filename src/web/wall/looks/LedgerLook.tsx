import { memo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { useLookClock } from '../../components/looks/lookShared';
import { formatWholeVolume } from '../../lib/lookData';
import { TapMarker } from '../TapMarker';
import {
  MenuQr, kicksInLabel, metaParts, spotlightState, tappedLabel, useWallModels,
} from './lookKit';
import styles from './LedgerLook.module.css';

/**
 * Ledger (V2): the cellar ledger. One ruled line per keg: when it went on, what poured
 * tonight, what's left (a level bar and pints) and when it will kick.
 */
export const LedgerLook = memo(function LedgerLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId, pageIndex, pageCount,
  } = props;
  const clock = useLookClock();
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const pours = wall.reduce((n, m) => n + m.tonightPours, 0);
  const now = new Date();

  return (
    <div className={styles.look} data-look="ledger" data-testid="look-ledger">
      <header className={styles.header}>
        <h1 className={styles.title}>The cellar ledger</h1>
        <p className={styles.meta} data-testid="look-meta">
          {metaParts([
            title,
            config.header.showClock && clock,
            `${pours} ${pours === 1 ? 'pour' : 'pours'} tonight`,
            pageCount > 1 && `page ${pageIndex + 1} of ${pageCount}`,
          ])}
        </p>
      </header>
      <div className={`${styles.line} ${styles.th}`} aria-hidden="true">
        <span>Tap</span><span>Beer</span><span>Tapped</span><span>Tonight</span><span>Left in the keg</span>
        <span className={styles.right}>Kicks in</span>
      </div>
      <div className={styles.rows} style={{ '--rows': Math.max(models.length, 8) } as CSSProperties}>
        {models.map((m) => (
          <div
            key={m.tap.tapId}
            className={styles.line}
            data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
            data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
          >
            <span className={styles.n}>{m.tapNumber}</span>
            <span className={styles.beer}>
              {m.hasBeer && <TapMarker model={m} size={44} showNumber={false} />}
              <span className={styles.what}>
                <span className={styles.name}>{m.name ?? 'Empty tap'}</span>
                <span className={styles.style}>
                  {m.pouring && m.pourLabel ? `Pouring now · ${m.pourLabel}` : metaParts([m.style, m.abv != null && `${m.abv}%`])}
                </span>
              </span>
            </span>
            <span className={styles.v}>{tappedLabel(m.tap.keg?.dateTapped, now)}</span>
            <span className={styles.v}>{m.tonightMl > 0 ? formatWholeVolume(m.tonightMl, units) : '—'}</span>
            <span className={styles.lv}>
              <span className={styles.bar}>
                <i style={{ '--level': m.isKicked ? 0 : m.levelPct / 100, background: m.beerColor } as CSSProperties} />
              </span>
              <b>{m.servings != null && !m.isKicked ? Math.round(m.servings) : '—'}</b>
            </span>
            <span className={`${styles.k} ${styles.right}`}>{kicksInLabel(m.kicksInDays, m.isKicked)}</span>
          </div>
        ))}
      </div>
      {(config.ticker || config.showQr) && (
        <footer className={styles.foot}>
          <p>{config.ticker}</p>
          {config.showQr && <MenuQr url={menuUrl} size={72} />}
        </footer>
      )}
    </div>
  );
});
