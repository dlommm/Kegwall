import type { KegBurnStat } from '../../../server/db/stats.js';
import type { CSSProperties } from 'react';
import { kicksInDays } from '../../lib/kegForecast';
import { beerColorFor } from '../../wall/wallModel';
import { isDarkBeer } from './ui';
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

/** Kegs at or under this level with no pace are "almost out", and lead the list. */
const LOW_PCT = 15;

type Ranked = KegBurnStat & { days: number | null };

/** Soonest to kick first: nearly empty kegs with no pace, then by projected day, then the rest. */
export function rankDepletion(data: KegBurnStat[], now: Date = new Date()): Ranked[] {
  const rank = (k: Ranked) => (k.days != null ? k.days : k.levelPct <= LOW_PCT ? -1 : 1e6);
  return data
    .map((k) => ({ ...k, days: kicksInDays(k.projectedKickDate, now) }))
    .sort((a, b) => rank(a) - rank(b) || a.levelPct - b.levelPct);
}

function whenText(k: Ranked): string {
  if (k.days != null) return k.days === 0 ? 'kicks today' : `kicks ${formatKickDate(k.projectedKickDate!)}`;
  return k.levelPct <= LOW_PCT ? 'almost out' : 'No recent pours';
}

/** "Midnight Oats is almost out: 760 mL left." / "Old Thunder kicks in ~2 days at this pace." */
export function depletionLead(first: Ranked | undefined, units: VolumeUnits): string | null {
  if (!first) return null;
  const left = `${formatVolumeMl(first.remainingMl, units)} left`;
  if (first.days != null) {
    const when = first.days === 0 ? 'kicks today' : first.days === 1 ? 'kicks tomorrow' : `kicks in about ${first.days} days`;
    return `${first.beerName} ${when} at this pace: ${left}.`;
  }
  return first.levelPct <= LOW_PCT ? `${first.beerName} is almost out: ${left}.` : null;
}

/**
 * Keg depletion (Kegwall 2.1 "i-deplete"): one ranked list, soonest to kick first. Each keg is
 * drawn filled with its beer to the level, with a sentence naming the next to go. The kick
 * phrasing matches Tonight's ("kicks in ~2 days") because both read the same projection.
 */
export function KegDepletionCards({ data, units }: KegDepletionCardsProps) {
  const ranked = rankDepletion(data);
  const lead = depletionLead(ranked[0], units);
  return (
    <div className="stats-section" data-testid="keg-depletion-cards">
      <h3 className="stats-chart__title">Keg depletion</h3>
      {data.length === 0 ? (
        <p className="admin-page-quiet" data-testid="keg-depletion-empty">
          No kegs on tap right now — depletion projections will appear here once one&rsquo;s tapped.
        </p>
      ) : (
        <>
          {lead && <p className="keg-depletion__lead" data-testid="keg-depletion-lead">{lead}</p>}
          <ol className="keg-depletion">
            {ranked.map((keg) => {
              const color = beerColorFor(keg.srm);
              return (
                <li key={keg.kegId} className="keg-depletion__row" data-testid="keg-depletion-card">
                  <span className="keg-depletion__beer" title={keg.beerName}>{keg.beerName}</span>
                  <span
                    className="keg-depletion__keg"
                    data-testid="keg-depletion-srm-chip"
                    data-dark-beer={isDarkBeer(color) || undefined}
                    style={{ '--srm': color, '--level': `${Math.max(2, Math.min(100, keg.levelPct))}%` } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="keg-depletion__when font-tabular">
                    <span>{`Tap ${keg.tapNumber} · ${formatVolumeMl(keg.remainingMl, units)} left · `}</span>
                    <span data-testid="keg-depletion-projection" className={keg.days != null && keg.days <= 3 ? 'adm-warn-text' : undefined}>
                      {whenText(keg)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
