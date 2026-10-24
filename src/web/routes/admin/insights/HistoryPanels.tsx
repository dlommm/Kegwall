import { formatVolumeMl } from '../../../lib/units';
import { money, monthLabel } from '../../../lib/adminFormat';
import { HourHistogramRow } from '../HourHistogramRow';
import { KegDepletionCards } from '../KegDepletionCards';
import { BeerVolumeChart } from '../BeerVolumeChart';
import { Leaderboard } from '../Leaderboard';
import type { VolumeUnits } from '../../../lib/units';
import type { AnalyticsData } from './useAnalyticsData';

// Insights › Analytics tabs about pours, beers, kegs and people (split out of StatsPage in
// Kegwall V2 M8). Each panel reads the shared analytics data; owner-cost tables render for
// admins only.

export interface PanelProps {
  d: AnalyticsData;
  units: VolumeUnits;
  isAdmin: boolean;
}

/** When people pour: the busiest-hours heatmap, pours by hour, and every pour in the range. */
export function PoursPanel({ d, units }: PanelProps) {
  const { pourHistory, days, pours, hours, heatmap } = d;
  return (
    <>
      {heatmap.length === 7 && (
        <section className="stats-section" data-testid="analytics-heatmap">
          <h3 className="stats-chart__title">{`Busiest hours · last ${days} days`}</h3>
          <div className="heatmap">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dow) => {
              const max = Math.max(1, ...heatmap.flat());
              return (
                <div key={day} className="heatmap__row">
                  <span className="heatmap__day">{day}</span>
                  {heatmap[dow]!.map((count, hour) => (
                    <span
                      // eslint-disable-next-line react/no-array-index-key -- hour is the identity
                      key={hour}
                      className="heatmap__cell"
                      title={`${day} ${hour}:00 — ${count} pour${count === 1 ? '' : 's'}`}
                      style={{ opacity: count === 0 ? 0.06 : 0.15 + (count / max) * 0.85 }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="stats-grid">
        <HourHistogramRow data={hours} />
      </div>
      <section className="stats-section" data-testid="analytics-pour-history">
        <h3 className="stats-chart__title">{`Pour history · ${pourHistory.length} shown`}</h3>
        {pourHistory.length === 0 ? (
          <p className="admin-page-quiet">No pours in this window.</p>
        ) : (
          <div className="analytics-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Tap</th>
                  <th scope="col">Beer</th>
                  <th scope="col">Drinker</th>
                  <th scope="col">Size</th>
                  <th scope="col">Q</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {pourHistory.map((row) => (
                  <tr key={row.id} data-testid="pour-history-row">
                    <td className="font-tabular">{new Date(row.ts).toLocaleString()}</td>
                    <td className="font-tabular">{row.tapNumber != null ? `Tap ${row.tapNumber}` : '—'}</td>
                    <td>{row.beerName}</td>
                    <td>{row.drinkerName ?? 'Unclaimed'}</td>
                    <td className="font-tabular">{formatVolumeMl(row.volumeMl, units)}</td>
                    <td className="font-tabular">{row.quality != null ? row.quality : '—'}</td>
                    <td className="font-tabular">{row.source.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Volume by beer in the range, and each beer's lifetime history. */
export function BeersPanel({ d, units }: PanelProps) {
  const { beerHistory, beers, kegs } = d;
  return (
    <>
      <div className="stats-grid">
        <BeerVolumeChart data={beers} units={units} />
      </div>
      <section className="stats-section" data-testid="analytics-beer-history">
        <h3 className="stats-chart__title">Beer history</h3>
        {beerHistory.length === 0 ? (
          <p className="admin-page-quiet">No beers poured yet.</p>
        ) : (
          <div className="analytics-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Beer</th>
                  <th scope="col">First tap</th>
                  <th scope="col">Kegs</th>
                  <th scope="col">Total</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Claimed</th>
                </tr>
              </thead>
              <tbody>
                {beerHistory.map((row) => (
                  <tr key={row.beerId} data-testid="beer-history-row">
                    <td>{row.beerName}</td>
                    <td className="font-tabular">{row.firstTap ? new Date(row.firstTap).toLocaleDateString() : '—'}</td>
                    <td className="font-tabular">{row.kegs}</td>
                    <td className="font-tabular">{formatVolumeMl(row.totalMl, units)}</td>
                    <td className="font-tabular">
                      {row.avgRating != null ? `★ ${row.avgRating} (${row.ratingCount})` : '—'}
                    </td>
                    <td className="font-tabular">{row.claimPct != null ? `${row.claimPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** Kegs on tap and when they'll kick; for admins, what each keg cost and monthly spend. */
export function KegsPanel({ d, units, isAdmin }: PanelProps) {
  const { kegCosts, monthlySpend, kegs } = d;
  return (
    <>
      <div className="stats-grid">
        <KegDepletionCards data={kegs} units={units} />
      </div>
      {isAdmin && (
        <section className="stats-section" data-testid="analytics-keg-costs">
          <h3 className="stats-chart__title">Keg cost history</h3>
          {kegCosts.length === 0 ? (
            <p className="admin-page-quiet">No keg costs recorded yet — add them in the swap wizard.</p>
          ) : (
            <div className="analytics-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Beer</th>
                    <th scope="col">Supplier</th>
                    <th scope="col">Paid</th>
                    <th scope="col">$/pint</th>
                    <th scope="col">Poured</th>
                    <th scope="col">Value left</th>
                  </tr>
                </thead>
                <tbody>
                  {kegCosts.map((row) => (
                    <tr key={row.kegId} data-testid="keg-cost-row">
                      <td>{row.beerName}</td>
                      <td>{row.supplierName ?? '—'}</td>
                      <td className="font-tabular">
                        {money(row.costCents)}
                      </td>
                      <td className="font-tabular">
                        {money(row.pricePerPintCents)}
                      </td>
                      <td className="font-tabular">{`${row.pouredPct}%`}</td>
                      <td className="font-tabular">
                        {money(row.valueLeftCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {isAdmin && monthlySpend.length > 0 && (
        <section className="stats-section" data-testid="analytics-monthly-spend">
          <h3 className="stats-chart__title">Monthly spend</h3>
          <div className="analytics-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Kegs</th>
                  <th scope="col">Spend</th>
                  <th scope="col">$/pint</th>
                </tr>
              </thead>
              <tbody>
                {monthlySpend.map((row) => (
                  <tr key={row.month} data-testid="monthly-spend-row">
                    <td>{monthLabel(row.month)}</td>
                    <td className="font-tabular">{row.kegs}</td>
                    <td className="font-tabular">{money(row.spendCents)}</td>
                    <td className="font-tabular">
                      {money(row.pricePerPintCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** The leaderboard (the one and only: games decorate it, never fork it) and pourer history. */
export function PeoplePanel({ d, units }: PanelProps) {
  const { pourerHistory, pours, leaderboardWindow, leaderboardRows, setLeaderboardWindow } = d;
  return (
    <>
      <div className="stats-grid">
        <Leaderboard
          data={leaderboardRows} units={units} window={leaderboardWindow}
          onWindowChange={setLeaderboardWindow}
        />
      </div>
      <section className="stats-section" data-testid="analytics-pourer-history">
        <h3 className="stats-chart__title">Pourer history</h3>
        {pourerHistory.length === 0 ? (
          <p className="admin-page-quiet">No claimed pours yet.</p>
        ) : (
          <div className="analytics-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Pourer</th>
                  <th scope="col">Pours</th>
                  <th scope="col">Volume</th>
                  <th scope="col">Avg pour</th>
                  <th scope="col">Q</th>
                  <th scope="col">Favorite</th>
                  <th scope="col">Last pour</th>
                </tr>
              </thead>
              <tbody>
                {pourerHistory.map((row) => (
                  <tr key={row.drinkerId} data-testid="pourer-history-row">
                    <td>{row.displayName}</td>
                    <td className="font-tabular">{row.pours}</td>
                    <td className="font-tabular">{formatVolumeMl(row.volumeMl, units)}</td>
                    <td className="font-tabular">{formatVolumeMl(row.avgPourMl, units)}</td>
                    <td className="font-tabular">{row.avgQuality != null ? row.avgQuality : '—'}</td>
                    <td>{row.favorite ?? '—'}</td>
                    <td className="font-tabular">{row.lastPour ? new Date(row.lastPour).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
