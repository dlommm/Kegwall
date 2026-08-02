import { useEffect, useState } from 'react';
import { getGameStrip } from '../lib/api';
import type { GameStrip as GameStripData } from '../lib/adminApi';

const ML_PER_OZ = 29.5735;
/** Re-poll the active game; there's no dedicated push channel, and a game strip changing
 *  every few seconds is fine at this cadence. */
const POLL_MS = 8000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

/** Human win-rule label for the strip header. */
const WIN_RULE_LABEL: Record<string, string> = {
  first_to_target: 'FIRST TO TARGET',
  highest: 'MOST POURED',
  lowest: 'LEAST POURED',
  closest: 'CLOSEST',
  prediction: 'BEST PREDICTION',
  survival: 'LAST STANDING',
};

/**
 * The live wall GAME STRIP (redesign 5c): rides above the footer ticker when a game is
 * running, additive to the normal wall render. Self-fetching so mounting it on the wall is
 * one line. Renders nothing when idle. Volume games show a per-player progress bar (leader
 * gold); the target comes from the session's `targetOz` setting, else it scales to the leader.
 */
export function GameStrip() {
  const [data, setData] = useState<GameStripData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getGameStrip().then((result) => {
        if (!cancelled && result.ok) setData(result.data);
      });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!data || data.players.length === 0) return null;

  const targetOz = typeof data.settings?.targetOz === 'number' ? data.settings.targetOz : null;
  const targetMl = targetOz != null ? targetOz * ML_PER_OZ : null;
  const leaderMl = Math.max(1, ...data.players.map((p) => p.volumeMl));
  const scaleMl = targetMl ?? leaderMl;
  const headline = targetOz != null
    ? `${data.gameName.toUpperCase()} · FIRST TO ${targetOz} OZ`
    : `${data.gameName.toUpperCase()} · ${WIN_RULE_LABEL[data.winRule] ?? data.winRule.toUpperCase()}`;

  return (
    <div className="game-strip" data-testid="game-strip">
      <div className="game-strip__head">
        <span className="game-strip__dot" aria-hidden="true" />
        <span className="game-strip__title font-display">{headline}</span>
        <span className="game-strip__tag">{data.tracking}</span>
      </div>
      <div className="game-strip__players">
        {data.players.map((p, i) => {
          const pct = Math.min(100, Math.round((p.volumeMl / scaleMl) * 100));
          const isLeader = i === 0 && p.volumeMl > 0;
          return (
            <div key={p.drinkerId} className="game-strip__player" data-testid="game-strip-player">
              <span className="game-strip__avatar font-display" style={{ backgroundColor: p.avatarColor ?? '#7A6C58' }}>
                {initials(p.displayName)}
              </span>
              <span className="game-strip__name">{p.displayName}</span>
              <span className="game-strip__bar" aria-hidden="true">
                <span
                  className={`game-strip__bar-fill${isLeader ? ' game-strip__bar-fill--leader' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="game-strip__figure font-tabular">
                {`${Math.round(p.volumeMl / ML_PER_OZ)} oz`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
