import { memo } from 'react';
import type { WallLookProps } from '../../components/looks/WallLook';
import { formatVolumeMl } from '../../lib/units';
import { formatWholeVolume } from '../../lib/lookData';
import type { WallTapModel } from '../wallModel';
import {
  MenuQr, spotlightState, useLookMeta, useWallModels,
} from './lookKit';
import styles from './TerminalLook.module.css';

const BAR = 20;

/** `s` cut to `n` characters with an ellipsis, then padded to exactly `n`. */
export function cell(s: string, n: number): string {
  const cut = s.length > n ? `${s.slice(0, n - 1)}…` : s;
  return cut.padEnd(n);
}

/** An ASCII keg gauge: one block per 5% full. */
export function asciiLevel(levelPct: number): string {
  const full = Math.round(Math.max(0, Math.min(100, levelPct)) / (100 / BAR));
  return '█'.repeat(full) + '░'.repeat(BAR - full);
}

function Row({ m, units, spotlightTapId }: { m: WallTapModel; units: WallLookProps['units']; spotlightTapId?: number | null }) {
  const n = String(m.tapNumber).padStart(3);
  const name = cell((m.name ?? 'empty').toLowerCase(), 28);
  const state = m.isKicked ? 'kicked' : m.pouring ? 'pouring' : m.isLow ? 'low' : 'ok';
  if (m.isKicked || !m.hasBeer) {
    return (
      <span className={styles.d} data-tap-state={state}>
        {`${n}  ${name}  ${m.isKicked ? 'kicked' : 'no keg'}${m.nextUpName ? `   next: ${m.nextUpName.toLowerCase()}` : ''}\n`}
      </span>
    );
  }
  const pints = String(Math.max(0, Math.round(m.servings ?? 0))).padStart(3);
  const tonight = m.tonightMl > 0 ? formatWholeVolume(m.tonightMl, units).padStart(8) : '       —';
  return (
    <span data-tap-state={state} data-spotlight={spotlightState(m.tap.tapId, spotlightTapId)} className={styles.row}>
      {`${n}  `}
      <span className={styles.h}>{name}</span>
      {'  '}
      <span className={styles.d}>{cell((m.style ?? '').toLowerCase(), 18)}</span>
      {'  '}
      <span className={m.isLow ? styles.w : undefined}>{`${asciiLevel(m.levelPct)} ${pints}`}</span>
      {`   ${String(m.lastHourPours).padStart(3)}  ${tonight}`}
      {m.pouring && m.pourLabel ? <span className={styles.live}>{`  ▶ pouring ${m.pourLabel}`}</span> : null}
      {'\n'}
    </span>
  );
}

/**
 * Terminal (V2): `top` for the taps. ASCII level bars and pints left, pours in the last hour,
 * tonight's volume, and the tail of the pour log. Monospace on a black screen, the same in
 * every theme.
 */
export const TerminalLook = memo(function TerminalLook(props: WallLookProps) {
  const {
    taps, allTaps, config, units, menuUrl, servingSizeMl = 473, spotlightTapId,
  } = props;
  const meta = useLookMeta(props);
  const models = useWallModels(taps, units, servingSizeMl);
  const wall = useWallModels(allTaps ?? taps, units, servingSizeMl);
  const onTap = wall.filter((m) => m.hasBeer && !m.isKicked).length;
  const pours = wall.reduce((s, m) => s + m.tonightPours, 0);
  const log = wall
    .filter((m) => m.tap.lastPour)
    .sort((a, b) => b.tap.lastPour!.ts.localeCompare(a.tap.lastPour!.ts))
    .slice(0, 3);

  return (
    <div className={styles.look} data-look="terminal" data-testid="look-terminal">
      <pre className={styles.pre}>
        <span className={styles.h}>kegwall top</span>
        <span className={styles.d} data-testid="look-meta">
          {` — ${[...meta.map((s) => s.toLowerCase()), `${onTap} on tap`, `${pours} pours tonight`].join(' · ')}\n\n`}
        </span>
        <span className={styles.inv}>
          {`TAP  ${cell('BEER', 28)}  ${cell('STYLE', 18)}  ${cell('LEFT IN KEG', BAR)} ${'PTS'.padStart(3)}   ${'1H'.padStart(3)}  ${'TONIGHT'.padStart(8)}`}
        </span>
        {'\n'}
        {models.map((m) => <Row key={m.tap.tapId} m={m} units={units} spotlightTapId={spotlightTapId} />)}
        {log.length > 0 && <span className={styles.d}>{'\npour log\n'}</span>}
        {log.map((m) => {
          const t = new Date(m.tap.lastPour!.ts);
          const hhmmss = t.toLocaleTimeString('en-GB', { hour12: false });
          return (
            <span key={m.tap.tapId}>
              <span className={styles.d}>{hhmmss}</span>
              {`  tap ${String(m.tapNumber).padEnd(3)} ${cell((m.name ?? '').toLowerCase(), 22)} ${formatVolumeMl(m.tap.lastPour!.volumeMl, units)}\n`}
            </span>
          );
        })}
        <span className={styles.cursor}>▌</span>
      </pre>
      {config.showQr && <div className={styles.qr}><MenuQr url={menuUrl} size={84} label="menu + claim your pour" /></div>}
    </div>
  );
});
