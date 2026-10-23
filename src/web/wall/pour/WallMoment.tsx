import type { CSSProperties } from 'react';
import { srmToColor, mixHex } from '../../lib/srm';
import { pickInk } from '../../lib/contrast';
import styles from './WallMoment.module.css';

/** A `wall_moment` WebSocket frame (server: core/milestones.ts). */
export type WallMomentEvent =
  | { kind: 'kicked'; tapNumber: number; beerName: string | null; nextBeerName: string | null }
  | { kind: 'tapped'; tapNumber: number; beerName: string | null; brewery: string | null; style: string | null; abv: number | null; srm: number | null }
  | { kind: 'milestone'; scope: 'taproom' | 'pourer'; count: number; pourerName: string | null; beerName: string | null };

/** How long a moment holds the screen. */
export const MOMENT_MS = 6500;

export function isWallMomentEvent(msg: unknown): msg is WallMomentEvent & { type: 'wall_moment' } {
  const m = msg as { type?: unknown; kind?: unknown } | null;
  return typeof m === 'object' && m !== null && m.type === 'wall_moment'
    && (m.kind === 'kicked' || m.kind === 'tapped' || m.kind === 'milestone');
}

/**
 * Wall moments (Kegwall V2, blueprint v0.6): full-screen events that aren't pours. Just kicked
 * (foam sputters, a KICKED stamp slams, the next keg slides in), Just tapped (a curtain of the
 * new beer's color wipes up and its name stamps in) and Milestone (the count rolls over with a
 * burst of rings). One-shot animations only; reduced motion turns them into fades.
 */
export function WallMoment({ moment }: { moment: WallMomentEvent }) {
  if (moment.kind === 'kicked') {
    return (
      <div className={styles.moment} data-kind="kicked" data-testid="wall-moment">
        <div className={styles.sputter} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ '--a': `${i * 30}deg` } as CSSProperties} />)}</div>
        <div className={styles.stamp}>Kicked</div>
        <h2 className={styles.title}>{moment.beerName ?? `Tap ${moment.tapNumber}`}</h2>
        <p className={styles.text}>{`Tap ${moment.tapNumber} ran dry.`}</p>
        {moment.nextBeerName && <p className={styles.next}>{'Next on tap '}{moment.tapNumber}{': '}<b>{moment.nextBeerName}</b></p>}
      </div>
    );
  }
  if (moment.kind === 'tapped') {
    const color = srmToColor(moment.srm).liquid;
    return (
      <div className={styles.moment} data-kind="tapped" data-testid="wall-moment" style={{ '--beer': color, '--beer-ink': pickInk(color), '--beer-deep': mixHex(color, '#000000', 0.2) } as CSSProperties}>
        <div className={styles.curtain} />
        <span className={styles.bignum} aria-hidden="true">{moment.tapNumber}</span>
        <h2 className={`${styles.title} ${styles.stampIn}`}>{moment.beerName ?? 'New keg'}</h2>
        <p className={styles.text}>
          {[`Just tapped on tap ${moment.tapNumber}`, moment.brewery, moment.style, moment.abv != null && `${moment.abv}%`].filter(Boolean).join(' · ')}
        </p>
      </div>
    );
  }
  const who = moment.scope === 'pourer' ? `${moment.pourerName ?? 'A regular'} has poured` : 'The house has poured';
  return (
    <div className={styles.moment} data-kind="milestone" data-testid="wall-moment">
      <div className={styles.burst} aria-hidden="true"><i /><i /><i /></div>
      <p className={styles.text}>{who}</p>
      <div className={styles.roll}>
        <div>
          <span>{(moment.count - 1).toLocaleString('en-US')}</span>
          <span className={styles.rollNew}>{moment.count.toLocaleString('en-US')}</span>
        </div>
      </div>
      <h2 className={styles.title} style={{ fontSize: 'calc(110 * var(--u, 1px))' }}>pours</h2>
      {moment.scope === 'taproom' && moment.beerName && (
        <p className={styles.text}>{`Number ${moment.count.toLocaleString('en-US')} was a ${moment.beerName}${moment.pourerName ? `, poured by ${moment.pourerName}` : ''}.`}</p>
      )}
    </div>
  );
}
