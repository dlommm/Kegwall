import { memo, useMemo, type CSSProperties } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { getTheme } from '../../themes/themes';
import { mixHex } from '../../lib/srm';
import { ensureContrast, pickInk } from '../../lib/contrast';
import { TapMarker } from '../TapMarker';
import { JUST_TAPPED_HOURS } from '../headline';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, metaParts, useLookMeta, pickSpotlight, spotlightState, useWallModels,
} from './lookKit';
import styles from './JustTappedLook.module.css';

/** Display size for the spotlight name: long names step down so they never overflow. */
export function spotlightNameSize(name: string): number {
  const n = name.length;
  if (n <= 12) return 196;
  if (n <= 20) return 150;
  if (n <= 32) return 116;
  return 88;
}

function spotlightSentence(m: WallTapModel, now: Date): { lead: string; rest: string } {
  const tappedMs = Date.parse(m.tap.keg?.dateTapped ?? '');
  const fresh = Number.isFinite(tappedMs) && now.getTime() - tappedMs <= JUST_TAPPED_HOURS * 3_600_000;
  const lead = fresh ? `Just tapped on tap ${m.tapNumber}.` : `On tap ${m.tapNumber}.`;
  const what = [m.brewery ? `${m.brewery}'s` : null, m.style ?? 'beer']
    .filter(Boolean).join(' ');
  const abv = m.abv != null ? `, ${m.abv}%` : '';
  const left = m.servingsLabel.startsWith('≈')
    ? ` and about ${m.servingsLabel.slice(2).replace(/ left$/, '')} left in the keg`
    : '';
  return { lead, rest: `${what.charAt(0).toUpperCase()}${what.slice(1)}${abv}${left}.` };
}

/**
 * Just Tapped (blueprint §C.1 direction A, the default look for new walls). The spotlight keg
 * owns the left half as a field of its own color, with its tap number set huge behind the
 * name. The right half lists every tap on a panel in a deep tone of the spotlight beer, keg
 * level stated in pints. Kicked kegs move to the footer sentence.
 */
export const JustTappedLook = memo(function JustTappedLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, title, menuUrl, servingSizeMl = 473, spotlightTapIds,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const wallModels = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const feature = useMemo(() => pickSpotlight(wallModels, config.spotlight), [wallModels, config.spotlight]);
  const mode = getTheme(config.theme?.id).mode;

  const rows = models.filter((m) => m.hasBeer && !m.isKicked);
  const kicked = models.filter((m) => m.isKicked && m.name);
  const panel = feature
    ? (mode === 'light' ? mixHex(feature.beerColor, '#FFFFFF', 0.86) : mixHex(feature.beerColor, '#000000', 0.76))
    : 'var(--color-ground)';
  const panelInk = feature ? pickInk(panel) : 'var(--color-ink-1)';
  const lowInk = feature ? ensureContrast(panelInk === '#FFFFFF' ? '#F4B740' : '#8A4F00', [panel], panelInk, 4.5) : null;
  const panelInk2 = feature ? ensureContrast(panelInk === '#FFFFFF' ? '#BDB6AA' : '#5C554C', [panel], panelInk, 4.5) : null;
  const sentence = feature ? spotlightSentence(feature, new Date()) : null;

  const footLine = kicked.length
    ? `${kicked.map((k) => k.name).join(', ')} kicked.${kicked[0]!.nextUpName ? ` ${kicked[0]!.nextUpName} goes on next.` : ''}`
    : config.ticker ?? '';

  return (
    <div className={styles.look} data-look="just-tapped" data-testid="look-just-tapped">
      {feature ? (
        <section
          className={styles.hero}
          style={{ background: feature.beerColor, color: feature.markerInk } as CSSProperties}
          data-testid="just-tapped-spotlight"
        >
          <span className={styles.bignum} style={{ color: mixHex(feature.beerColor, '#000000', 0.2) }} aria-hidden="true">
            {feature.tapNumber}
          </span>
          <div className={styles.copy}>
            <h1 className={styles.heroName} style={{ '--name-size': spotlightNameSize(feature.name ?? '') } as CSSProperties}>
              {feature.name}
            </h1>
            <p className={styles.heroText}>
              <b>{sentence!.lead}</b> {sentence!.rest}
            </p>
          </div>
        </section>
      ) : (
        <section className={`${styles.hero} ${styles.heroEmpty}`} data-testid="just-tapped-spotlight">
          <div className={styles.copy}>
            <h1 className={styles.heroName} style={{ '--name-size': 150 } as CSSProperties}>Nothing on tap</h1>
          </div>
        </section>
      )}

      <section
        className={styles.list}
        style={{
          '--panel': panel, '--panel-ink': panelInk, '--panel-ink-2': panelInk2 ?? panelInk, '--panel-low': lowInk ?? panelInk,
        } as CSSProperties}
      >
        <header className={styles.top}>
          <span className={styles.brand}>{title}</span>
          <span className={styles.meta} data-testid="look-meta">
            {metaParts(meta)}
          </span>
        </header>
        <ol className={styles.rows} style={{ '--rows': Math.max(rows.length, 8) } as CSSProperties}>
          {rows.map((m) => (
            <li
              key={m.tap.tapId}
              className={styles.row}
              data-tap-state={m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
              data-feature={feature && m.tap.tapId === feature.tap.tapId ? 'true' : undefined}
              data-spotlight={spotlightState(m.tap.tapId, spotlightTapIds)}
            >
              <span className={styles.tapNo}>{m.tapNumber}</span>
              <TapMarker model={m} size={62} showNumber={false} />
              <span className={styles.what}>
                <span className={styles.name}>{m.name}</span>
                <span className={styles.style}>
                  {m.pouring && m.pourLabel ? `Pouring now · ${m.pourLabel}` : metaParts([m.style, m.abv != null && `${m.abv}%`])}
                </span>
              </span>
              <span className={styles.left}>
                <b>{m.servings != null ? Math.max(0, Math.round(m.servings)) : '—'}</b>
                <span>{`${m.servingNoun}${Math.round(m.servings ?? 0) === 1 ? '' : 's'} left`}</span>
              </span>
            </li>
          ))}
        </ol>
        <footer className={styles.foot}>
          <p>{footLine}</p>
          {config.showQr && <MenuQr url={menuUrl} />}
        </footer>
      </section>
    </div>
  );
});
