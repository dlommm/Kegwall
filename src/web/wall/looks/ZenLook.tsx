import { memo, useMemo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import {
  MenuQr, levelColor, metaParts, pickSpotlight, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './ZenLook.module.css';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * Zen (V2): one beer at a time. The spotlight keg's orb holds what's left; a quiet list beside
 * it shows everyone else's level. Paper and ink: the same in every theme.
 */
export const ZenLook = memo(function ZenLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, menuUrl, servingSizeMl = 473, spotlightTapIds,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const f = useMemo(() => pickSpotlight(wall, config.spotlight), [wall, config.spotlight]);
  const onTap = models.filter((m) => m.hasBeer && !m.isKicked);
  const count = wall.filter((m) => m.hasBeer && !m.isKicked).length;
  const left = f?.servings != null ? Math.max(0, Math.round(f.servings)) : null;

  return (
    <div className={styles.look} data-look="zen" data-testid="look-zen">
      <main className={styles.main}>
        {/* The featured beer in its true color, filled to its level with a foam line on top,
            so the disc never reads as an empty grey placeholder (Kegwall 2.1 "g-looks"). */}
        <div
          className={styles.orb}
          role="img"
          aria-label={f ? `${f.levelPct}% left` : 'empty'}
          style={f ? { '--level': f.levelPct / 100, '--beer': f.beerColor } as CSSProperties : undefined}
          data-has-beer={f ? true : undefined}
        >
          {f && <i style={{ background: f.beerColor } as CSSProperties} />}
        </div>
        <div>
          <span className={styles.k} data-testid="look-meta">
            {metaParts([f && `Tap ${f.tapNumber}`, `one of ${COUNT_WORDS[count] ?? count} tonight`, ...meta])}
          </span>
          <h1 className={styles.name}>{f?.name ?? 'Nothing on tap'}</h1>
          {f && (
            <p className={styles.text}>
              {f.notes ? `${f.notes} ` : ''}
              {f.abv != null ? `${f.abv}%. ` : ''}
              {left != null && <b>{`About ${left} ${f.servingNoun}${left === 1 ? '' : 's'} left.`}</b>}
            </p>
          )}
        </div>
      </main>
      <aside className={styles.aside}>
        {onTap.map((m) => (
          <div
            key={m.tap.tapId}
            className={styles.item}
            data-on={f && m.tap.tapId === f.tap.tapId ? 'true' : undefined}
            data-tap-state={m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
            data-spotlight={spotlightState(m.tap.tapId, spotlightTapIds)}
          >
            <span className={styles.itemName}>{m.name}</span>
            <span className={styles.itemLeft}>{Math.max(0, Math.round(m.servings ?? 0))}</span>
            <i><b style={{ '--level': m.levelPct / 100, background: levelColor(m.beerColor) } as CSSProperties} /></i>
          </div>
        ))}
        {config.showQr && <div className={styles.qr}><MenuQr url={menuUrl} size={72} /></div>}
      </aside>
    </div>
  );
});
