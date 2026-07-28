import type { KegBurnStat } from '../../../server/db/stats.js';
import { srmToColor } from '../../lib/srm';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';

export interface KegDepletionCardsProps {
  data: KegBurnStat[];
  units: VolumeUnits;
}

/** `2026-08-09` -> `Aug 9` — UTC, matching how `activeKegStats` (db/stats.ts) computes
 * `projectedKickDate`, so the card's date always names the exact day the projection
 * landed on rather than shifting by a viewer's timezone. */
export function formatKickDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/**
 * `/admin/stats`'s per-keg depletion cards (Task 9) — not a chart, per the plan's own
 * framing ("per-keg depletion cards"): a level bar, remaining volume, and a projected
 * kick date in the "Kicks around Aug 9" phrasing the plan specifies verbatim, or "No
 * recent pours" when `projectedKickDate` is `null` (a keg with a zero trailing-7-day
 * burn rate — see `activeKegStats`). The SRM chip is the one place liquid/SRM color
 * reappears here, per the binding design direction — a small dot, matching
 * `BeersPage`'s `.beers-table__srm-chip`, never a full `LiquidFill`.
 */
export function KegDepletionCards({ data, units }: KegDepletionCardsProps) {
  return (
    <div className="stats-section" data-testid="keg-depletion-cards">
      <h3 className="stats-chart__title">Keg depletion</h3>
      {data.length === 0 ? (
        <p className="admin-page-quiet" data-testid="keg-depletion-empty">
          No kegs on tap right now — depletion projections will appear here once one&rsquo;s tapped.
        </p>
      ) : (
        <ul className="keg-depletion-grid">
          {data.map((keg) => (
            <li key={keg.kegId} className="keg-depletion-card" data-testid="keg-depletion-card">
              <div className="keg-depletion-card__header">
                <span
                  className="stats-srm-chip"
                  data-testid="keg-depletion-srm-chip"
                  style={{ backgroundColor: srmToColor(keg.srm).liquid }}
                  aria-hidden="true"
                />
                <span className="keg-depletion-card__beer">{keg.beerName}</span>
                <span className="keg-depletion-card__tap font-tabular">Tap {keg.tapNumber}</span>
              </div>
              <div className="keg-depletion-card__bar" aria-hidden="true">
                <span
                  className="keg-depletion-card__bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, Math.round(keg.levelPct)))}%` }}
                />
              </div>
              <p className="keg-depletion-card__level font-tabular">
                {Math.round(keg.levelPct)}% · {formatVolumeMl(keg.remainingMl, units)} left
              </p>
              <p className="keg-depletion-card__projection" data-testid="keg-depletion-projection">
                {keg.projectedKickDate
                  ? `Kicks around ${formatKickDate(keg.projectedKickDate)}`
                  : 'No recent pours'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
