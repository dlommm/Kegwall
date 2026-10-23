import { useState, type CSSProperties } from 'react';
import { getGameStrip } from '../../lib/api';
import { usePolledFetch } from '../../lib/usePolledFetch';
import { initials } from '../../lib/initials';
import type { GameStrip } from '../../lib/adminApi';
import type { VolumeUnits } from '../../lib/units';
import { volumeParts, laneVolumeMl, EasedVolume } from './pourKit';
import type { PourLane } from './usePourLanes';
import styles from './PourLayer.module.css';

/** The running game, polled only while `enabled` (a Game On pour is on screen). */
export function useGame(enabled: boolean): GameStrip | null {
  const [game, setGame] = useState<GameStrip | null>(null);
  usePolledFetch((isCancelled) => {
    getGameStrip().then((r) => {
      if (!isCancelled() && r.ok) setGame(r.data && r.data.players.length ? r.data : null);
    });
  }, { intervalMs: 8000, enabled });
  return enabled ? game : null;
}

/**
 * Game On (Kegwall V2): shown only while a game runs. The standings stay on screen during the
 * pour; when the pour is recorded and attributed, it is added to that player's bar, the order
 * updates, and a new leader is called out. One game, one board: this decorates the existing
 * game data and never keeps a ranking of its own.
 */
export function GameOn({ game, lanes, units }: { game: GameStrip; lanes: PourLane[]; units: VolumeUnits }) {
  const lane = lanes[lanes.length - 1]!;
  const finished = lane.phase !== 'pouring';
  const credited = finished && lane.pourerName && lane.recordedMl != null ? lane.pourerName : null;
  const before = [...game.players].sort((a, b) => b.volumeMl - a.volumeMl);
  const after = before
    .map((p) => (p.displayName === credited ? { ...p, volumeMl: p.volumeMl + (lane.recordedMl ?? 0) } : p))
    .sort((a, b) => b.volumeMl - a.volumeMl);
  const rows = finished ? after : before;
  const top = Math.max(1, ...rows.map((p) => p.volumeMl));
  const newLeader = credited && after[0]?.displayName === credited && before[0]?.displayName !== credited;
  const targetOz = typeof game.settings?.targetOz === 'number' ? game.settings.targetOz : null;
  const ml = laneVolumeMl(lane);

  return (
    <div className={styles.layer} data-style="gameon" data-lanes="1" data-testid="takeover-gameon">
      <div className={styles.gameBody}>
        <span className={styles.gameTag}>{targetOz ? `${game.gameName} · first to ${targetOz} oz` : game.gameName}</span>
        <h2 className={styles.name}>
          {newLeader ? `${credited} takes the lead` : `Tap ${lane.tap.tapNumber} is pouring`}
        </h2>
        <EasedVolume className={styles.counter} ml={ml} units={units} final={finished} />
        <div className={styles.gameRows}>
          {rows.slice(0, 5).map((p) => (
            <div key={p.drinkerId} className={styles.gameRow} data-me={p.displayName === credited ? 'true' : undefined}>
              <span className={styles.avatar} style={{ background: p.avatarColor ?? '#C8963E' }}>{initials(p.displayName)}</span>
              <b>{p.displayName}</b>
              <span className={styles.track}><i style={{ '--g': (p.volumeMl / top).toFixed(3) } as CSSProperties} /></span>
              <span className={styles.gameValue}>{`${volumeParts(p.volumeMl, units).value} ${volumeParts(p.volumeMl, units).unit}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
