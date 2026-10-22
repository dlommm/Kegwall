import { memo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { getTheme } from '../../themes/themes';
import { mixHex } from '../../lib/srm';
import { TapMarker } from '../TapMarker';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, metaParts, useLookMeta, spotlightState, useWallModels,
} from './lookKit';
import styles from './ClassicLook.module.css';

/** The density ladder (blueprint §E.1): how a page of N taps is composed. */
export type ClassicDensity = 'hero' | 'cards' | 'rows';

export function classicDensity(count: number): ClassicDensity {
  if (count <= 4) return 'hero';
  if (count <= 8) return 'cards';
  return 'rows';
}

/** The keg fill behind a card: a deep tone of the beer on dark themes, a pale tint on light. */
export function kegFillColor(beerColor: string, mode: 'dark' | 'light'): string {
  return mode === 'light' ? mixHex(beerColor, '#FFFFFF', 0.62) : mixHex(beerColor, '#000000', 0.58);
}

function Card({ m, mode, spotlightTapIds }: { m: WallTapModel; mode: 'dark' | 'light'; spotlightTapIds?: ReadonlySet<number> | null }) {
  const level = m.isKicked || !m.hasBeer ? 0 : m.levelPct / 100;
  const n = m.servings != null ? Math.max(0, Math.round(m.servings)) : null;
  return (
    <article
      className={styles.card}
      data-tap-state={m.isKicked ? 'kicked' : !m.hasBeer ? 'empty' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
      data-spotlight={spotlightState(m.tap.tapId, spotlightTapIds)}
      style={{
        '--beer': m.beerColor,
        '--fill': kegFillColor(m.beerColor, mode),
        '--level': level,
      } as CSSProperties}
      data-testid="classic-card"
    >
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.surface} aria-hidden="true" />
      <div className={styles.top}>
        {m.hasBeer ? <TapMarker model={m} size={72} showNumber={false} /> : <span />}
        <span className={styles.tapNo}>{`Tap ${m.tapNumber}`}</span>
      </div>
      <h2 className={styles.name} data-testid="classic-card-name">{m.name ?? 'Empty tap'}</h2>
      <span className={styles.style}>
        {m.pouring && m.pourLabel ? `Pouring now · ${m.pourLabel}` : metaParts([m.style, m.abv != null && `${m.abv}%`])}
      </span>
      <div className={styles.left}>
        {m.isKicked ? (
          <span className={styles.leftWord}>{m.nextUpName ? `Kicked · next up ${m.nextUpName}` : 'Kicked'}</span>
        ) : n != null ? (
          <>
            <b>{n}</b>
            <span>{`${m.servingNoun}${n === 1 ? '' : 's'} left`}</span>
          </>
        ) : (
          <span className={styles.leftWord}>No keg</span>
        )}
      </div>
    </article>
  );
}

/**
 * Classic (V2): the tap list where every card is its keg, filled from the bottom in the
 * beer's deep tone to the level, with pints left as the anchor. The page composition follows
 * the density ladder: up to 4 taps as hero cards, 5-8 as a 4 × 2 grid, 9-12 as board rows.
 */
export const ClassicLook = memo(function ClassicLook(props: WallLookProps) {
  const {
    taps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapIds,
  } = props;
  const meta = useLookMeta(props, { tempLabel: '' });
  const models = useWallModels(taps, units, servingSizeMl);
  const mode = getTheme(config.theme?.id).mode;
  const density = classicDensity(models.length);

  return (
    <div
      className={styles.look}
      data-look="classic"
      data-density={density}
      data-testid="look-classic"
      // Cards: two rows, as many columns as fill them (5-6 taps → 3 wide, 7-8 → 4 wide).
      style={{ '--cols': density === 'cards' ? Math.ceil(models.length / 2) : 2 } as CSSProperties}
    >
      <header className={styles.header}>
        <h1 className={styles.brand}>{title}</h1>
        <span className={styles.meta} data-testid="look-meta">
          {metaParts(meta)}
        </span>
      </header>
      <div className={styles.grid}>
        {models.map((m) => <Card key={m.tap.tapId} m={m} mode={mode} spotlightTapIds={spotlightTapIds} />)}
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
