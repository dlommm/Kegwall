import { memo, type CSSProperties } from 'react';
import '@fontsource/tilt-neon/400.css';
import type { WallLookProps } from '../../components/looks/WallLook';
import { relativeLuminance } from '../../lib/contrast';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, metaParts, servingsWord, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './NeonLook.module.css';

const RING_R = 80;
const RING_C = 2 * Math.PI * RING_R;

/** A neon tube in the beer's color; stouts too dark to glow burn orange instead. */
function tubeFor(m: WallTapModel): string {
  return relativeLuminance(m.beerColor) < 0.05 ? '#FF8A3D' : m.beerColor;
}

/**
 * Neon (V2): a wall of bar signs. Each tap's neon ring is drawn as far round as its keg is
 * full, with the pints left glowing inside. The dark brick wall is material: the same in
 * every theme.
 */
export const NeonLook = memo(function NeonLook(props: WallLookProps) {
  const {
    taps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);

  return (
    <div className={styles.look} data-look="neon" data-testid="look-neon">
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.meta} data-testid="look-meta">{metaParts(['open late', ...meta])}</p>
        {config.showQr && <MenuQr url={menuUrl} size={72} />}
      </header>
      <div className={styles.grid} style={{ '--cols': Math.min(4, Math.max(2, Math.ceil(models.length / 2))) } as CSSProperties}>
        {models.map((m) => {
          const level = m.isKicked || !m.hasBeer ? 0 : m.levelPct / 100;
          const n = m.servings != null ? Math.max(0, Math.round(m.servings)) : null;
          return (
            <div
              key={m.tap.tapId}
              className={styles.sign}
              style={{ '--c': tubeFor(m) } as CSSProperties}
              data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
            >
              <div className={styles.ring}>
                <svg viewBox="0 0 190 190" aria-hidden="true">
                  <circle cx="95" cy="95" r={RING_R} className={styles.track} />
                  <circle
                    cx="95"
                    cy="95"
                    r={RING_R}
                    className={styles.tube}
                    strokeDasharray={`${(RING_C * level).toFixed(1)} ${RING_C.toFixed(1)}`}
                    transform="rotate(-90 95 95)"
                  />
                </svg>
                <span className={styles.count}>
                  {m.isKicked ? 'out' : n ?? '—'}
                  {!m.isKicked && n != null && <small>{`${servingsWord(m, n)} left`}</small>}
                </span>
              </div>
              <h2 className={styles.name}>{m.name ?? 'Empty tap'}</h2>
              <p className={styles.sub}>
                {m.pouring && m.pourLabel ? `Pouring now · ${m.pourLabel}` : metaParts([`Tap ${m.tapNumber}`, m.style, m.abv != null && `${m.abv}%`])}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
});
