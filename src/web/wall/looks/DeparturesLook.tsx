import { memo } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './DeparturesLook.module.css';

/** A split-flap field: `text` upper-cased, cut and padded to `n` flaps. */
function Flaps({ text, n }: { text: string; n: number }) {
  const chars = text.toUpperCase().slice(0, n).padEnd(n).split('');
  return (
    <span className={styles.flaps} aria-label={text.trim()}>
      {chars.map((c, i) => (
        // eslint-disable-next-line react/no-array-index-key -- flaps are positional
        <i key={i} aria-hidden="true">{c === ' ' ? ' ' : c}</i>
      ))}
    </span>
  );
}

/** Kegs board like flights: the one kicking soonest departs first; kicked kegs last. */
export function departureOrder(a: WallTapModel, b: WallTapModel): number {
  // A low keg with no pace yet is boarding now, not last: it ranks with "today".
  const rank = (m: WallTapModel) => (m.isKicked || !m.hasBeer ? 1e6
    : m.kicksInDays ?? (m.isLow ? 0 : 1e5));
  return rank(a) - rank(b) || (a.servings ?? 0) - (b.servings ?? 0) || a.tapNumber - b.tapNumber;
}

function status(m: WallTapModel): { text: string; tone: string } {
  if (m.isKicked) return { text: 'DEPARTED', tone: 'gone' };
  if (!m.hasBeer) return { text: 'NO KEG', tone: 'gone' };
  if (m.pouring) return { text: 'POURING NOW', tone: 'pour' };
  if (m.isLow) return { text: 'BOARDING · LAST CALL', tone: 'board' };
  return { text: 'ON TAP', tone: 'ok' };
}

function departsIn(m: WallTapModel): string {
  if (m.isKicked || !m.hasBeer) return '—';
  if (m.kicksInDays == null) return m.isLow ? 'SOON' : '—';
  if (m.kicksInDays <= 1) return '~1 DAY';
  return `~${m.kicksInDays} DAYS`;
}

/**
 * Departures (V2): the board at the gate. Kegs are flights, sorted by when each will kick;
 * pints left run on split flaps, low kegs are boarding, kicked kegs have departed. Black
 * board, yellow type: the same in every theme.
 */
export const DeparturesLook = memo(function DeparturesLook(props: WallLookProps) {
  const {
    taps, config, units, menuUrl, servingSizeMl = 473, spotlightTapIds,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const rows = [...models].sort(departureOrder);

  return (
    <div className={styles.look} data-look="departures" data-testid="look-departures">
      <header className={styles.header}>
        <h1>DEPARTURES</h1>
        <span data-testid="look-meta">{meta.join(' · ').toUpperCase()}</span>
        {config.showQr && <MenuQr url={menuUrl} size={64} label="Menu and claim your pour" />}
      </header>
      <div className={`${styles.line} ${styles.th}`} aria-hidden="true">
        <span>TAP</span><span>BEER</span><span>PINTS LEFT</span><span>DEPARTS IN</span><span>STATUS</span>
      </div>
      {rows.map((m) => {
        const s = status(m);
        const pints = m.isKicked || m.servings == null ? '--' : String(Math.max(0, Math.round(m.servings))).padStart(2, '0');
        return (
          <div
            key={m.tap.tapId}
            className={styles.line}
            data-tap-state={m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok'}
            data-spotlight={spotlightState(m.tap.tapId, spotlightTapIds)}
          >
            <Flaps text={String(m.tapNumber).padStart(2, '0')} n={2} />
            <Flaps text={m.name ?? 'EMPTY'} n={20} />
            <Flaps text={pints} n={2} />
            <span className={styles.small}>{departsIn(m)}</span>
            <span className={styles.status} data-tone={s.tone}>{s.text}</span>
          </div>
        );
      })}
    </div>
  );
});
