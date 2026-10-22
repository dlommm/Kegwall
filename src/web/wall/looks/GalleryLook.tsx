import { memo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { useLookClock } from '../../components/looks/lookShared';
import {
  MenuQr, levelColor, metaParts, spotlightState, useWallModels,
} from './lookKit';
import styles from './GalleryLook.module.css';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * Gallery (V2): a museum wall. Each beer hangs as a framed color plate painted to its level,
 * with a wall label beside it. The frames and paper are material, so they stay the same on
 * every theme; the wall behind them is the theme's ground.
 */
export const GalleryLook = memo(function GalleryLook(props: WallLookProps) {
  const {
    taps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId, pageIndex, pageCount,
  } = props;
  const clock = useLookClock();
  const models = useWallModels(taps, units, servingSizeMl);
  const pouring = models.filter((m) => m.hasBeer && !m.isKicked).length;

  return (
    <div className={styles.look} data-look="gallery" data-testid="look-gallery">
      <header className={styles.header}>
        <h1 className={styles.title}>{`Now showing at ${title}`}</h1>
        <span className={styles.meta} data-testid="look-meta">
          {metaParts([
            config.header.showClock && clock,
            `${COUNT_WORDS[pouring] ?? pouring} ${pouring === 1 ? 'work' : 'works'} pouring`,
            pageCount > 1 && `room ${pageIndex + 1} of ${pageCount}`,
          ])}
        </span>
        {config.showQr && <MenuQr url={menuUrl} size={64} />}
      </header>
      <div className={styles.wall}>
        {models.map((m) => (
          <figure
            key={m.tap.tapId}
            className={styles.work}
            data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
            data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
          >
            <div className={styles.frame}>
              <div className={styles.canvas}>
                <i style={{ '--level': m.isKicked ? 0 : m.levelPct / 100, background: levelColor(m.beerColor) } as CSSProperties} />
              </div>
            </div>
            <figcaption className={styles.label}>
              <span className={styles.no}>{`No. ${m.tapNumber}`}</span>
              <h2 className={styles.name}>{m.name ?? 'Empty tap'}</h2>
              <p>
                {m.brewery}
                {m.brewery && <br />}
                {metaParts([m.style, m.abv != null && `${m.abv}%`])}
              </p>
              <b>{m.pouring && m.pourLabel ? `Pouring now · ${m.pourLabel}` : m.servingsLabel}</b>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
});
