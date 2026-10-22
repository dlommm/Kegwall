import { memo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { ensureContrast } from '../../lib/contrast';
import { wallHeadline } from '../headline';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, metaParts, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './TallyLook.module.css';

const BOARD = '#F4F3EF';
/** More marks than this per keg and each mark stands for five servings. */
const MAX_MARKS = 60;

/** Marks for a keg: filled = servings left, spent = servings poured, grouped in fives. */
export function tallyMarks(m: Pick<WallTapModel, 'servings' | 'fullServings'>): { per: number; filled: number; total: number } {
  const full = m.fullServings ?? 0;
  const per = full > MAX_MARKS ? 5 : 1;
  return { per, total: Math.ceil(full / per), filled: Math.round(Math.max(0, m.servings ?? 0) / per) };
}

function Marks({ m }: { m: WallTapModel }) {
  const { total, filled } = tallyMarks(m);
  const groups = [];
  for (let g = 0; g * 5 < total; g++) {
    const marks = [];
    for (let k = 0; k < 5 && g * 5 + k < total; k++) {
      marks.push(<i key={k} data-filled={g * 5 + k < filled ? 'true' : undefined} />);
    }
    groups.push(<span key={g}>{marks}</span>);
  }
  return <span className={styles.tally} aria-hidden="true">{groups}</span>;
}

/**
 * Tally (V2, new): a bartender's tally board. The night is written as a sentence at the top;
 * each keg's remaining pints are tally marks in the beer's color (spent ones greyed). A bright
 * board with black rules, the same in every theme.
 */
export const TallyLook = memo(function TallyLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapIds,
  } = props;
  const meta = useLookMeta(props, { tempLabel: '' });
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const headline = wallHeadline(wall, units);
  const anyFive = models.some((m) => tallyMarks(m).per === 5);
  const noun = models[0]?.servingNoun ?? 'pint';
  const [clock, ...rest] = config.header.showClock ? meta : [null, ...meta];

  return (
    <div className={styles.look} data-look="tally" data-testid="look-tally">
      <header className={styles.header}>
        <h1 className={styles.sentence}>{headline.detail ? `${headline.lead} ${headline.detail}` : headline.lead}</h1>
        <div className={styles.side} data-testid="look-meta">
          {clock && <b>{clock}</b>}
          {metaParts([title, ...rest])}
        </div>
      </header>
      <main className={styles.board} style={{ '--rows': Math.max(4, Math.ceil(models.length / 2)) } as CSSProperties}>
        {models.map((m) => {
          const n = m.servings != null ? Math.max(0, Math.round(m.servings)) : null;
          return (
            <div
              key={m.tap.tapId}
              className={styles.tap}
              style={{ '--beer': ensureContrast(m.beerColor, [BOARD], '#121110', 3) ?? m.beerColor } as CSSProperties}
              data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapIds)}
            >
              <span className={styles.n}>{m.tapNumber}</span>
              <span className={styles.what}>
                <span className={styles.name}>{m.name ?? 'Empty tap'}</span>
                <span className={styles.style}>
                  {m.pouring && m.pourLabel
                    ? `Pouring now · ${m.pourLabel} so far`
                    : m.isKicked
                      ? `Kicked${m.nextUpName ? ` · ${m.nextUpName} goes on next` : ''}`
                      : metaParts([m.style, m.abv != null && `${m.abv}%`])}
                </span>
              </span>
              {m.hasBeer && !m.isKicked ? <Marks m={m} /> : <span />}
              <span className={styles.count}>{m.isKicked ? '' : n ?? ''}</span>
            </div>
          );
        })}
      </main>
      <footer className={styles.foot}>
        <span>{anyFive ? `Each mark is five ${noun}s still in the keg.` : `Each mark is a ${noun} still in the keg.`}</span>
        {config.showQr && <MenuQr url={menuUrl} size={72} />}
      </footer>
    </div>
  );
});
