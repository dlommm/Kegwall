import { memo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { relativeLuminance } from '../../lib/contrast';
import { mixHex } from '../../lib/srm';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, formatPrice, metaParts, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './ChalkboardLook.module.css';

const MAX_MARKS = 30;

/** A beer's chalk color: its own color, lifted when it is too dark to read on slate. */
function chalkFor(m: WallTapModel): string {
  return relativeLuminance(m.beerColor) < 0.12 ? mixHex(m.beerColor, '#F3E9B8', 0.62) : m.beerColor;
}

/** One chalk gate: up to four uprights and the strike across them for the fifth. */
function Gate({ count }: { count: number }) {
  const strokes = [];
  for (let i = 0; i < Math.min(count, 4); i++) {
    strokes.push(<path key={i} d={`M${6 + i * 9} ${4 + (i % 2)} L${5 + i * 9} 40`} />);
  }
  if (count >= 5) strokes.push(<path key="x" d="M1 30 L38 10" />);
  return (
    <svg className={styles.gate} viewBox="0 0 42 44" aria-hidden="true">
      {strokes}
    </svg>
  );
}

function Tally({ n }: { n: number }) {
  const gates = [];
  for (let left = Math.min(n, MAX_MARKS), i = 0; left > 0; left -= 5, i++) gates.push(<Gate key={i} count={Math.min(5, left)} />);
  return (
    <span className={styles.tally} aria-hidden="true">
      {gates}
      {n > MAX_MARKS && <span>{`+${n - MAX_MARKS}`}</span>}
    </span>
  );
}

/**
 * Chalkboard (V2): the bar's own chalk menu. Each beer's tap number is chalked in its color,
 * prices sit on the right when the owner shows them, and the pints left are chalk tally gates
 * (one stroke per pint). Slate and chalk are material: they look the same in every theme.
 */
export const ChalkboardLook = memo(function ChalkboardLook(props: WallLookProps) {
  const {
    taps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const prices = models.map((m) => m.priceCents).filter((p): p is number => p != null);
  const range = prices.length
    ? `${models[0]!.servingNoun}s ${formatPrice(Math.min(...prices))}${Math.max(...prices) > Math.min(...prices) ? ` – ${formatPrice(Math.max(...prices))}` : ''}`
    : null;

  return (
    <div className={styles.look} data-look="chalkboard" data-testid="look-chalkboard">
      <header className={styles.header}>
        <h1 className={styles.title}>On tap tonight</h1>
        <p className={styles.side} data-testid="look-meta">
          {title}
          <br />
          {metaParts([range, ...meta])}
        </p>
      </header>
      <div className={styles.menu} style={{ '--rows': Math.max(4, Math.ceil(models.length / 2)) } as CSSProperties}>
        {models.map((m) => {
          const n = m.servings != null ? Math.max(0, Math.round(m.servings)) : 0;
          return (
            <div
              key={m.tap.tapId}
              className={styles.item}
              style={{ '--chalk': chalkFor(m) } as CSSProperties}
              data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
            >
              <div className={styles.what}>
                <h2 className={styles.name}><em>{m.tapNumber}</em>{m.name ?? 'Empty tap'}</h2>
                <p>
                  {m.pouring && m.pourLabel
                    ? `pouring now · ${m.pourLabel}`
                    : metaParts([m.style, m.abv != null && `${m.abv}%`, m.isKicked ? 'all gone' : m.isLow ? 'last call!' : m.hasBeer && m.servingsLabel.replace('≈ ', '')])}
                </p>
                {m.hasBeer && !m.isKicked && <Tally n={n} />}
              </div>
              <span className={styles.price}>{m.priceCents != null ? formatPrice(m.priceCents) : ''}</span>
            </div>
          );
        })}
      </div>
      {config.showQr && (
        <footer className={styles.foot}>
          <MenuQr url={menuUrl} size={72} />
        </footer>
      )}
    </div>
  );
});
