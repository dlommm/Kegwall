import { Link } from 'react-router-dom';
import type { LeaderboardEntry } from '../../../server/db/stats.js';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';

export type LeaderboardWindow = 'week' | 'month' | 'all';

export interface LeaderboardProps {
  data: LeaderboardEntry[];
  units: VolumeUnits;
  window: LeaderboardWindow;
  onWindowChange: (window: LeaderboardWindow) => void;
}

const WINDOWS: readonly LeaderboardWindow[] = ['week', 'month', 'all'];
const WINDOW_LABELS: Record<LeaderboardWindow, string> = {
  week: 'This week', month: 'This month', all: 'All time',
};

/**
 * `/admin/stats`'s drinker leaderboard (Task 9) — pour count + volume per drinker,
 * claimed pours only (see `leaderboard`, db/stats.ts), already sorted descending by
 * volume server-side. A plain table, not a chart — the plan calls it out as "leaderboard
 * table", and rank-by-row reads more precisely than bars would for what's fundamentally
 * a ranked list. The avatar dot matches `UsersPage`'s `.users-avatar-dot` treatment
 * exactly (same fallback to a neutral `var(--text-dim)` when a drinker has no
 * `avatarColor` set).
 *
 * Phase 5 Task 0: also links to `/admin/pours` — a simple recent-pours table where an
 * editor can reassign or unclaim a pour's drinker (`setPourDrinker`) when the leaderboard
 * looks wrong because a pour got mis-claimed. Visible to every role (the link itself is
 * always safe to follow; PoursPage's own reassign/unclaim controls are editor-gated).
 */
export function Leaderboard({ data, units, window, onWindowChange }: LeaderboardProps) {
  return (
    <div className="stats-section" data-testid="leaderboard">
      <div className="stats-chart__header">
        <h3 className="stats-chart__title">Leaderboard</h3>
        <div className="stats-switcher" role="group" aria-label="Leaderboard time window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className="stats-switcher__option"
              data-testid={`leaderboard-window-${w}`}
              aria-pressed={window === w}
              onClick={() => onWindowChange(w)}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </div>
      <Link to="/admin/pours" className="stats-chart__manage-link" data-testid="leaderboard-manage-pours-link">
        Manage pours (reassign or unclaim a drinker)
      </Link>
      {data.length === 0 ? (
        <p className="admin-page-quiet" data-testid="leaderboard-empty">
          No claimed pours yet — the leaderboard fills in once drinkers claim their pours.
        </p>
      ) : (
        <table className="admin-table" data-testid="leaderboard-table">
          <thead>
            <tr>
              <th scope="col">Drinker</th>
              <th scope="col">Pours</th>
              <th scope="col">Volume</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.drinkerId} data-testid="leaderboard-row">
                <td className="leaderboard-row__drinker">
                  <span
                    className="leaderboard-avatar-dot"
                    aria-hidden="true"
                    style={{ backgroundColor: row.avatarColor ?? 'var(--text-dim)' }}
                  />
                  {row.displayName}
                </td>
                <td className="font-tabular">{row.pourCount}</td>
                <td className="font-tabular">{formatVolumeMl(row.volumeMl, units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
