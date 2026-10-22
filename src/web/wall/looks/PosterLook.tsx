import { memo, useMemo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { ensureContrast } from '../../lib/contrast';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, levelColor, metaParts, pickSpotlight, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './PosterLook.module.css';

const PAPER = '#F0E6D2';
const INK = '#1A1410';

/** Headliner size: the name has to stay on one or two lines of the poster. */
export function headlinerSize(name: string): number {
  const n = name.length;
  if (n <= 10) return 230;
  if (n <= 16) return 170;
  if (n <= 28) return 120;
  return 84;
}

/** Billing lines under the headliner step down in size, like a festival poster. */
function billing(rest: WallTapModel[]): Array<{ size: number; acts: WallTapModel[] }> {
  return [
    { size: 120, acts: rest.slice(0, 2) },
    { size: 88, acts: rest.slice(2, 5) },
    { size: 66, acts: rest.slice(5, 9) },
    { size: 52, acts: rest.slice(9) },
  ].filter((l) => l.acts.length);
}

/**
 * Poster (V2): a festival line-up. The spotlight keg headlines in its own color, the rest
 * are billed in steps below with the pints each has left, and the strip under the headliner
 * is every keg's level side by side. Printed on paper: the same in every theme.
 */
export const PosterLook = memo(function PosterLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapIds,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const head = useMemo(() => pickSpotlight(wall, config.spotlight), [wall, config.spotlight]);
  const onTap = models.filter((m) => m.hasBeer && !m.isKicked);
  const rest = onTap.filter((m) => m.tap.tapId !== head?.tap.tapId);
  const kicked = models.filter((m) => m.isKicked && m.name);
  const headInk = head ? ensureContrast(head.beerColor, [PAPER], INK, 3) ?? INK : INK;
  const headLeft = head?.servings != null ? Math.max(0, Math.round(head.servings)) : null;

  return (
    <div className={styles.look} data-look="poster" data-testid="look-poster">
      <div className={styles.pre} data-testid="look-meta">{metaParts([`${title} presents`, 'tonight', ...meta])}</div>
      {head && (
        <>
          <div className={styles.headliner} style={{ color: headInk, '--name-size': headlinerSize(head.name ?? '') } as CSSProperties}>
            {head.name}
          </div>
          <div className={styles.pre}>
            {metaParts([head.brewery, head.style, head.abv != null && `${head.abv}%`, headLeft != null && `${headLeft} ${head.servingNoun}${headLeft === 1 ? '' : 's'} left`])}
          </div>
        </>
      )}
      <div className={styles.bar} aria-label="Every keg's level">
        {onTap.map((m) => (
          <i key={m.tap.tapId} style={{ '--level': m.levelPct / 100, '--beer': levelColor(m.beerColor) } as CSSProperties} />
        ))}
      </div>
      {billing(rest).map((line) => (
        <div key={line.size} className={styles.line} style={{ '--size': line.size } as CSSProperties}>
          {line.acts.map((m) => (
            <span
              key={m.tap.tapId}
              data-tap-state={m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapIds)}
            >
              {m.name}
              <em>{m.pouring && m.pourLabel ? `pouring ${m.pourLabel}` : `${Math.max(0, Math.round(m.servings ?? 0))} left`}</em>
            </span>
          ))}
        </div>
      ))}
      <div className={styles.foot}>
        <span>{kicked.length ? `Also: ${kicked.map((k) => k.name).join(', ')}, kicked` : config.ticker ?? ''}</span>
        {config.showQr && <MenuQr url={menuUrl} size={72} />}
      </div>
    </div>
  );
});
