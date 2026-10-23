import { formatVolumeMl, type VolumeUnits } from '../lib/units';
import { initials } from '../lib/initials';
import type { LeaderboardResponse } from '../lib/api';
import './LeaderboardBoard.css';

const ML_PER_GALLON = 3785.411784;

/** "12.3 gal" / "46.7 L" — the board's per-pourer volume figure. */
export function formatBoardVolume(ml: number, units: VolumeUnits): string {
  if (units === 'metric') return `${(ml / 1000).toFixed(1)} L`;
  return `${(ml / ML_PER_GALLON).toFixed(1)} gal`;
}

/** Medal treatment per podium rank (redesign 2f): gold / silver / bronze rings + labels. */
const MEDALS: Record<1 | 2 | 3, { color: string; label: string }> = {
  1: { color: '#E7B93F', label: 'CHAMPION' },
  2: { color: '#C0C7CE', label: '2ND' },
  3: { color: '#C77B4A', label: '3RD' },
};

const WINDOW_TABS = [
  { key: 'week', label: 'WEEK' },
  { key: 'month', label: 'MONTH' },
  { key: 'all', label: 'ALL TIME' },
] as const;

export interface LeaderboardBoardProps {
  data: LeaderboardResponse;
  units: VolumeUnits;
  title: string;
  onWindowChange?: (window: LeaderboardResponse['window']) => void;
}

/**
 * The one and only leaderboard as a 1920×1080 TV view (redesign 2f). Top 3 get a medal
 * podium (2nd · 1st · 3rd, champion centered and tallest); ranks 4+ are compact rows with a
 * colored quality pill; the footer carries superlatives as trophy chips. Game results post
 * HERE (Phase 5) as temporary chips — there is deliberately no separate game leaderboard.
 * Pure/presentational — `/board` fetches; the wall rotation reuses it.
 */
export function LeaderboardBoard({ data, units, title, onWindowChange }: LeaderboardBoardProps) {
  const podium = data.entries.slice(0, 3);
  const rest = data.entries.slice(3);
  // Visual order places 2nd on the left, champion center, 3rd right.
  const visualPodium = [podium[1], podium[0], podium[2]]
    .map((entry, i) => ({ entry, rank: ([2, 1, 3] as const)[i]! }))
    .filter((p): p is { entry: NonNullable<typeof p.entry>; rank: 1 | 2 | 3 } => p.entry != null);
  const { superlatives } = data;

  return (
    <div className="board-look" data-testid="leaderboard-board">
      <header className="board-look__header">
        <span className="board-look__title font-display">{title}</span>
        <span className="board-look__brand font-display">LEADERBOARD</span>
        <div className="board-look__windows" role="group" aria-label="Leaderboard window">
          {WINDOW_TABS.map((w) => onWindowChange ? (
            <button
              type="button" key={w.key}
              className="board-look__window-pill"
              data-active={data.window === w.key}
              aria-pressed={data.window === w.key}
              data-testid={`board-window-${w.key}`}
              onClick={() => onWindowChange(w.key)}
            >{w.label}</button>
          ) : (
            <span
              key={w.key}
              className="board-look__window-pill"
              data-active={data.window === w.key}
              data-testid={`board-window-${w.key}`}
            >
              {w.label}
            </span>
          ))}
        </div>
      </header>

      {data.entries.length === 0 ? (
        <p className="board-look__empty" data-testid="leaderboard-empty">
          No claimed pours yet — pour one and claim it from the menu.
        </p>
      ) : (
        <>
          <div className="board-podium" data-testid="leaderboard-podium">
            {visualPodium.map(({ entry, rank }) => {
              const medal = MEDALS[rank];
              return (
                <div
                  key={entry.drinkerId}
                  className={`board-podium__card board-podium__card--${rank === 1 ? 'first' : 'other'}`}
                  data-testid="leaderboard-podium-card"
                  data-rank={rank}
                  style={{
                    borderColor: medal.color,
                    background: `color-mix(in srgb, ${medal.color} 10%, transparent)`,
                  }}
                >
                  <span
                    className="board-podium__avatar font-display"
                    style={{
                      backgroundColor: entry.avatarColor ?? '#7A6C58',
                      boxShadow: `0 0 0 3px var(--bg), 0 0 0 6px ${medal.color}`,
                    }}
                  >
                    {initials(entry.displayName)}
                  </span>
                  <span className="board-podium__label" style={{ color: medal.color }}>{medal.label}</span>
                  <span className="board-podium__name font-display">{entry.displayName}</span>
                  <span className={`board-podium__figure font-tabular board-podium__figure--${rank === 1 ? 'first' : 'other'}`}>
                    {formatBoardVolume(entry.volumeMl, units)}
                  </span>
                  <span className="board-podium__caption font-tabular" data-testid="leaderboard-quality">
                    {`${entry.pourCount} pours · ${entry.avgQuality != null ? `Q ${entry.avgQuality}` : '—'}`}
                  </span>
                </div>
              );
            })}
          </div>

          {rest.length > 0 && (
            <div className="board-look__rows">
              {rest.map((entry, i) => (
                <div key={entry.drinkerId} className="board-row" data-testid="leaderboard-row">
                  <span className="board-row__rank font-display font-tabular">{i + 4}</span>
                  <span className="board-row__avatar font-display" style={{ backgroundColor: entry.avatarColor ?? '#7A6C58' }}>
                    {initials(entry.displayName)}
                  </span>
                  <span className="board-row__name font-display">{entry.displayName}</span>
                  <span className="board-row__figure font-tabular">{`${entry.pourCount} pours`}</span>
                  <span className="board-row__figure font-tabular">{formatBoardVolume(entry.volumeMl, units)}</span>
                  <span
                    className={`board-row__quality-pill board-row__quality-pill--${entry.avgQuality != null && entry.avgQuality >= 80 ? 'good' : 'low'}`}
                    data-testid="leaderboard-quality"
                  >
                    {entry.avgQuality != null ? `Q ${entry.avgQuality}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <footer className="board-look__footer" data-testid="leaderboard-superlatives">
        {superlatives.mostPours && (
          <span className="board-trophy board-trophy--gold">
            {`🏆 MOST POURS: ${superlatives.mostPours.displayName} · ${superlatives.mostPours.pourCount}`}
          </span>
        )}
        {superlatives.smoothest && (
          <span className="board-trophy board-trophy--green">
            {`✨ SMOOTHEST: ${superlatives.smoothest.displayName} · ${superlatives.smoothest.avgQuality}`}
          </span>
        )}
        {superlatives.biggestPour && (
          <span className="board-trophy board-trophy--copper">
            {`🍺 BIGGEST POUR: ${superlatives.biggestPour.displayName} · ${formatVolumeMl(superlatives.biggestPour.volumeMl, units)}`}
          </span>
        )}
        {superlatives.gameWinner && (
          <span className="board-trophy board-trophy--game" data-testid="board-game-winner">
            {`🎮 ${superlatives.gameWinner.gameName.toUpperCase()}: ${superlatives.gameWinner.displayName}`}
          </span>
        )}
      </footer>
    </div>
  );
}
