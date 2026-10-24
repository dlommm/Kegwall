import { formatVolumeMl } from '../../../lib/units';
import { formatWholeVolume } from '../../../lib/lookData';
import { PoursChart } from '../PoursChart';
import { money, wholeMoney } from '../../../lib/adminFormat';
import { beerColorFor } from '../../../wall/wallModel';
import { ML_PER_PINT } from '../../../../server/core/pricing.js';
import type { PanelProps } from './HistoryPanels';


/**
 * The Overview: KPIs as type, not tiles (blueprint §E.7). A figure with no data prints "—",
 * never 0, with a line saying why (issue 16: "Avg quality 0" when nothing was scored).
 */
export function OverviewPanel({ d, units }: PanelProps) {
  const {
    kpis, days, pours, beers, leaderboardRows,
  } = d;
  // Highlights as sentences (Kegwall 2.1 "i-sentences"), each one a finding, not a label.
  const highlights: { text: string; share?: { color: string; pct: number } }[] = [];
  const [top, second] = beers;
  if (top) {
    const total = beers.reduce((sum, b) => sum + b.volumeMl, 0);
    const vs = second && second.volumeMl > 0 ? top.volumeMl / second.volumeMl : null;
    const more = vs == null ? '' : vs >= 1.95 ? `, twice what ${second!.beerName} did`
      : vs >= 1.3 ? `, a third more than ${second!.beerName}` : vs > 1.05 ? `, a little ahead of ${second!.beerName}` : `, neck and neck with ${second!.beerName}`;
    highlights.push({
      text: `${top.beerName} poured the most: ${formatVolumeMl(top.volumeMl, units)}${more}.`,
      share: total > 0 ? { color: beerColorFor(top.srm), pct: Math.round((top.volumeMl / total) * 100) } : undefined,
    });
  }
  const busiest = [...pours].sort((a, b) => b.count - a.count)[0];
  if (busiest && busiest.count > 0) {
    const day = new Date(`${busiest.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    highlights.push({ text: `The busiest day was ${day}, with ${busiest.count} pour${busiest.count === 1 ? '' : 's'}.` });
  }
  if (leaderboardRows[0]) {
    const p = leaderboardRows[0];
    highlights.push({ text: `${p.displayName} poured the most often: ${p.pourCount} pour${p.pourCount === 1 ? '' : 's'}.` });
  }

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
                {money(kpis.costPerPintCents)}
              </b>
              <span>cost per pint</span>
              <small>
                {kpis.valueOnTapCents == null
                  ? 'owners only' /* redacted for viewer accounts (pricing.showCostsToViewers off) */
                  : kpis.valueOnTapCents > 0
                    ? `${wholeMoney(kpis.valueOnTapCents)} of beer on tap`
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
              <li key={h.text} data-testid="analytics-highlight">
                {h.text}
                {h.share && (
                  <span className="analytics-highlights__share" aria-hidden="true">
                    <i style={{ width: `${h.share.pct}%`, background: h.share.color }} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
