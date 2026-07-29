import { formatVolumeMl, type VolumeUnits } from '../lib/units';
import type { LeaderboardResponse } from '../lib/api';

const ML_PER_GALLON = 3785.411784;

/** "12.3 gal" / "46.7 L" — the board's per-pourer volume figure. */
export function formatBoardVolume(ml: number, units: VolumeUnits): string {
  if (units === 'metric') return `${(ml / 1000).toFixed(1)} L`;
  return `${(ml / ML_PER_GALLON).toFixed(1)} gal`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

export interface LeaderboardBoardProps {
  data: LeaderboardResponse;
  units: VolumeUnits;
  title: string;
}

/**
 * The pourer leaderboard as a TV view (design 4a's LEADERBOARD rotation view +
 * 6b's quality column and footer superlatives). Pure/presentational — the
 * `/board` route fetches; Phase 5's rotation playlists reuse it inside the
 * wall. Ranked by volume, bar widths relative to #1, quality column from the
 * flow-consistency score.
 */
export function LeaderboardBoard({ data, units, title }: LeaderboardBoardProps) {
  const top = data.entries[0];
  const windowLabel = { week: 'THIS WEEK', month: 'THIS MONTH', all: 'ALL TIME' }[data.window];
  const { superlatives } = data;

  return (
    <div className="board-look" data-testid="leaderboard-board">
      <header className="board-look__header">
        <span className="board-look__title font-display">{title}</span>
        <span className="board-look__window font-display">{`LEADERBOARD · ${windowLabel}`}</span>
      </header>

      {data.entries.length === 0 ? (
        <p className="board-look__empty" data-testid="leaderboard-empty">
          No claimed pours yet — pour one and claim it from the menu.
        </p>
      ) : (
        <div className="board-look__rows">
          {data.entries.map((entry, i) => (
            <div key={entry.drinkerId} className="board-row" data-testid="leaderboard-row">
              <span className="board-row__rank font-display font-tabular">{i + 1}</span>
              <span className="board-row__avatar font-display" style={{ backgroundColor: entry.avatarColor ?? '#7A6C58' }}>
                {initials(entry.displayName)}
              </span>
              <div className="board-row__main">
                <span className="board-row__name font-display">{entry.displayName}</span>
                <div className="board-row__bar">
                  <div
                    className="board-row__bar-fill"
                    style={{ width: `${top && top.volumeMl > 0 ? Math.round((entry.volumeMl / top.volumeMl) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <span className="board-row__figure font-tabular">{`${entry.pourCount} pours`}</span>
              <span className="board-row__figure font-tabular">{formatBoardVolume(entry.volumeMl, units)}</span>
              <span className="board-row__quality font-tabular" data-testid="leaderboard-quality">
                {entry.avgQuality != null ? `Q ${entry.avgQuality}` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <footer className="board-look__footer" data-testid="leaderboard-superlatives">
        {superlatives.mostPours && (
          <span className="board-look__superlative">
            {`MOST POURS: ${superlatives.mostPours.displayName} · ${superlatives.mostPours.pourCount}`}
          </span>
        )}
        {superlatives.smoothest && (
          <span className="board-look__superlative">
            {`SMOOTHEST POUR: ${superlatives.smoothest.displayName} · ${superlatives.smoothest.avgQuality}`}
          </span>
        )}
        {superlatives.biggestPour && (
          <span className="board-look__superlative">
            {`BIGGEST POUR: ${superlatives.biggestPour.displayName} · ${formatVolumeMl(superlatives.biggestPour.volumeMl, units)}`}
          </span>
        )}
      </footer>
    </div>
  );
}
