import { memo, useMemo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, levelColor, metaParts, pickSpotlight, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './EditorialLook.module.css';

/** The feature's headline size, stepped down for long names. */
export function featureNameSize(name: string): number {
  const n = name.length;
  if (n <= 14) return 168;
  if (n <= 24) return 124;
  if (n <= 40) return 96;
  return 76;
}

function standfirst(m: WallTapModel): string {
  if (m.notes) return m.notes;
  const what = [m.brewery ? `${m.brewery}'s` : null, m.style ?? 'beer'].filter(Boolean).join(' ');
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${m.abv != null ? `, ${m.abv}%` : ''}.`;
}

/**
 * Editorial (V2): a magazine feature. The spotlight keg is the cover story, set in Playfair
 * on a page of its own color; every other tap is the contents page beside it, each with a
 * thin level rule and what's left.
 */
export const EditorialLook = memo(function EditorialLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapId,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const feature = useMemo(() => pickSpotlight(wall, config.spotlight), [wall, config.spotlight]);
  const rest = models.filter((m) => m.hasBeer && !m.isKicked && m.tap.tapId !== feature?.tap.tapId);
  const n = feature?.servings != null ? Math.max(0, Math.round(feature.servings)) : null;

  return (
    <div className={styles.look} data-look="editorial" data-testid="look-editorial">
      <section
        className={styles.feature}
        style={feature ? { '--f': feature.beerColor, '--fi': feature.markerInk } as CSSProperties : undefined}
      >
        <div className={styles.kick} data-testid="look-meta">
          <span>{metaParts([title, "tonight's feature", ...meta])}</span>
          {feature && <span>{`Tap ${feature.tapNumber}`}</span>}
        </div>
        <div>
          <h1 className={styles.headline} style={{ '--name-size': featureNameSize(feature?.name ?? '') } as CSSProperties}>
            {feature?.name ?? 'Nothing on tap tonight'}
          </h1>
          {feature && <p className={styles.standfirst}>{standfirst(feature)}</p>}
        </div>
        {feature && (
          <div className={styles.facts}>
            {feature.abv != null && <span><b>{`${feature.abv}%`}</b>alcohol</span>}
            {feature.ibu != null && <span><b>{feature.ibu}</b>IBU</span>}
            {n != null && <span><b>{n}</b>{`${feature.servingNoun}${n === 1 ? '' : 's'} left`}</span>}
          </div>
        )}
      </section>
      <section className={styles.contents}>
        <h2 className={styles.contentsTitle}>Also on tap</h2>
        <ol className={styles.list}>
          {rest.map((m) => (
            <li
              key={m.tap.tapId}
              data-tap-state={m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)}
            >
              <span className={styles.n}>{m.tapNumber}</span>
              <div className={styles.entry}>
                <h3>{m.name}</h3>
                <div className={styles.level}>
                  <i><b style={{ '--level': m.levelPct / 100, background: levelColor(m.beerColor) } as CSSProperties} /></i>
                  {m.pouring && m.pourLabel ? `Pouring now · ${m.pourLabel}` : m.servingsLabel}
                </div>
              </div>
              <span className={styles.abv}>{m.abv != null ? `${m.abv}%` : ''}</span>
            </li>
          ))}
        </ol>
        {config.showQr && <div className={styles.qr}><MenuQr url={menuUrl} size={72} /></div>}
      </section>
    </div>
  );
});
