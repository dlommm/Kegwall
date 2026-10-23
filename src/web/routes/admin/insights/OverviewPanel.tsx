import { formatVolumeMl } from '../../../lib/units';
import { formatWholeVolume } from '../../../lib/lookData';
import { PoursChart } from '../PoursChart';
import type { PanelProps } from './HistoryPanels';

const ML_PER_PINT = 473.176;

/**
 * The Overview: KPIs as type, not tiles (blueprint §E.7). A figure with no data prints "—",
 * never 0, with a line saying why (issue 16: "Avg quality 0" when nothing was scored).
 */
export function OverviewPanel({ d, units }: PanelProps) {
  const {
    kpis, days, pours, beers, leaderboardRows,
  } = d;
  const highlights: string[] = [];
  if (beers[0]) highlights.push(`Top beer: ${beers[0].beerName} · ${formatVolumeMl(beers[0].volumeMl, units)}`);
  const busiest = [...pours].sort((a, b) => b.count - a.count)[0];
  if (busiest && busiest.count > 0) highlights.push(`Busiest day: ${new Date(`${busiest.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${busiest.count} pours`);
  if (leaderboardRows[0]) highlights.push(`Top pourer: ${leaderboardRows[0].displayName} · ${leaderboardRows[0].pourCount} pours`);
  if (kpis?.costPerPintCents != null) highlights.push(`Cost per pint: $${(kpis.costPerPintCents / 100).toFixed(2)}`);

  return (
    <>
      {kpis && (
        <>
          <p className="adm-note" data-testid="analytics-kpis-range">{`KPIs · last ${days} days`}</p>
          <div className="adm-kpis" data-testid="analytics-kpis">
            <div className="adm-kpi">
              <b data-testid="kpi-pours">{kpis.pours.toLocaleString()}</b>
              <span>pours</span>
            </div>
            <div className="adm-kpi">
              <b data-testid="kpi-volume">{formatWholeVolume(kpis.volumeMl, units)}</b>
              <span>poured</span>
              {kpis.volumeMl > 0 && <small>{`about ${Math.round(kpis.volumeMl / ML_PER_PINT).toLocaleString()} pints`}</small>}
            </div>
            <div className="adm-kpi">
              <b data-testid="kpi-kicked">{kpis.kegsKicked}</b>
              <span>kegs kicked</span>
            </div>
            <div className="adm-kpi">
              <b data-testid="kpi-cost">
                {kpis.costPerPintCents != null ? `$${(kpis.costPerPintCents / 100).toFixed(2)}` : '—'}
              </b>
              <span>cost per pint</span>
              <small>
                {kpis.valueOnTapCents == null
                  ? 'owners only' /* redacted for viewer accounts (pricing.showCostsToViewers off) */
                  : kpis.valueOnTapCents > 0
                    ? `$${(kpis.valueOnTapCents / 100).toFixed(0)} of beer on tap`
                    : 'set keg costs to track it'}
              </small>
            </div>
            <div className="adm-kpi">
              <b data-testid="kpi-quality">{kpis.avgQuality != null ? kpis.avgQuality : '—'}</b>
              <span>average pour quality</span>
              {kpis.avgQuality == null && <small>no Kegtron quality data yet</small>}
            </div>
          </div>
        </>
      )}
      <div className="stats-grid">
        <PoursChart data={pours} units={units} />
      </div>
      {highlights.length > 0 && (
        <section className="stats-section" data-testid="analytics-highlights">
          <h3 className="stats-chart__title">Highlights</h3>
          <ul className="analytics-highlights">
            {highlights.map((h) => (
              <li key={h} data-testid="analytics-highlight">{h}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
