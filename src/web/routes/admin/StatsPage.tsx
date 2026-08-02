import { useEffect, useState } from 'react';
import type {
  PoursByDay, HourHistogram, KegBurnStat, BeerVolumeStat, LeaderboardEntry, AnalyticsKpis,
} from '../../../server/db/stats.js';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import {
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume,
  getStatsTemps, getLeaderboard, listMonitors, getAnalyticsKpis, getHourHeatmap,
  getHostStatsHistory, getKegCosts, getMonthlySpend, getPourHistory,
  getBeerHistory, getPourerHistory, getSensors, getSources, doctorUdpHistory,
  type HostStatsHistoryPoint, type KegCostRow, type MonthlySpendRow, type PourHistoryRow,
  type BeerHistoryRow, type PourerHistoryRow, type SensorSummary, type UdpDeviceHistory,
} from '../../lib/adminApi';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { formatVolumeMl, formatTempC } from '../../lib/units';
import { groupMonitors, deviceLabel } from '../../lib/monitorDevices';
import { PoursChart } from './PoursChart';
import { HourHistogramRow } from './HourHistogramRow';
import { KegDepletionCards } from './KegDepletionCards';
import { BeerVolumeChart } from './BeerVolumeChart';
import { TempChart } from './TempChart';
import { HostStatsChart } from './HostStatsChart';
import { Leaderboard, type LeaderboardWindow } from './Leaderboard';
import { useAdminContext } from './useAdminContext';

/** The pours/beers range switcher's three values — Task 9's plan specifies exactly
 * these three, both server-side (routes/stats.ts 400s on anything else) and here. */
const DAY_RANGES = [7, 30, 90] as const;
type DayRange = (typeof DAY_RANGES)[number];
const DEFAULT_DAYS: DayRange = 30;

/** The analytics hub's 9 tabs (WebUI redesign 4e/4j), Grafana-style. Existing panels are
 * distributed across them; every panel stays mounted (tab-switch hides via `hidden`) so the
 * one-shot fetches keep every tab live and deep-links/tests reach any panel. */
const ANALYTICS_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'pours', label: 'Pours' },
  { key: 'beers', label: 'Beers & styles' },
  { key: 'kegs', label: 'Kegs & cost' },
  { key: 'people', label: 'People' },
  { key: 'temps', label: 'Temps' },
  { key: 'server', label: 'Server' },
  { key: 'devices', label: 'Devices & ingest' },
  { key: 'raw', label: 'Raw' },
] as const;
type AnalyticsTab = (typeof ANALYTICS_TABS)[number]['key'];

/** Serialize an array of flat records to CSV (header row + escaped values). */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Trigger a client-side download of `text` as `filename`. */
function download(text: string, filename: string, type = 'text/csv'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * `/admin/stats` (Task 9): pours/day, hour-of-day, per-keg depletion, volume-by-beer,
 * temperature, and a drinker leaderboard — six independent viewer-role read endpoints
 * (`routes/stats.ts`), each rendered by its own presentational chart component fed
 * plain fixture-shaped data, per the Charts style binding. One day-range switcher (7/30/
 * 90) drives BOTH the pours and beers charts at once (the plan: "applies to pours +
 * beers") rather than each picking its own range independently. The leaderboard owns a
 * separate week/month/all window, and the temp chart owns its own monitor picker —
 * neither of those is shared with anything else on the page.
 */
export function StatsPage() {
  const { units, me } = useAdminContext();
  const isAdmin = me.role === 'admin';
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [kegCosts, setKegCosts] = useState<KegCostRow[]>([]);
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpendRow[]>([]);
  const [pourHistory, setPourHistory] = useState<PourHistoryRow[]>([]);
  const [beerHistory, setBeerHistory] = useState<BeerHistoryRow[]>([]);
  const [pourerHistory, setPourerHistory] = useState<PourerHistoryRow[]>([]);
  const [sensors, setSensors] = useState<SensorSummary[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [udpDevices, setUdpDevices] = useState<UdpDeviceHistory[]>([]);

  const [days, setDays] = useState<DayRange>(DEFAULT_DAYS);
  const [pours, setPours] = useState<PoursByDay[]>([]);
  const [beers, setBeers] = useState<BeerVolumeStat[]>([]);
  const [hours, setHours] = useState<HourHistogram[]>([]);
  const [kegs, setKegs] = useState<KegBurnStat[]>([]);

  const [proDevices, setProDevices] = useState<{ monitorId: number; label: string }[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [temps, setTemps] = useState<TelemetryPoint[]>([]);

  const [leaderboardWindow, setLeaderboardWindow] = useState<LeaderboardWindow>('week');
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardEntry[]>([]);
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [heatmap, setHeatmap] = useState<number[][]>([]);
  const [hostStats, setHostStats] = useState<HostStatsHistoryPoint[]>([]);

  // Per-keg owner-cost breakdown + monthly spend (admin-only; the endpoints 403 for non-admins).
  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    getKegCosts().then((result) => {
      if (!cancelled && result.ok) setKegCosts(result.data);
    });
    getMonthlySpend().then((result) => {
      if (!cancelled && result.ok) setMonthlySpend(result.data);
    });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Pour-history table follows the same day-range switcher as the pours/beers charts.
  useEffect(() => {
    let cancelled = false;
    getPourHistory(days).then((result) => {
      if (!cancelled && result.ok) setPourHistory(result.data);
    });
    return () => { cancelled = true; };
  }, [days]);

  // Lifetime beer + pourer history tables (Beers / People tabs) — load once.
  useEffect(() => {
    let cancelled = false;
    getBeerHistory().then((result) => { if (!cancelled && result.ok) setBeerHistory(result.data); });
    getPourerHistory().then((result) => { if (!cancelled && result.ok) setPourerHistory(result.data); });
    getSensors().then((result) => { if (!cancelled && result.ok) setSensors(result.data); });
    getSources().then((result) => { if (!cancelled && result.ok) setSources(result.data); });
    doctorUdpHistory(24).then((result) => { if (!cancelled && result.ok) setUdpDevices(result.data.devices); });
    return () => { cancelled = true; };
  }, []);

  // Server-health history (Pi monitoring epic) — the host sampler's last 24h.
  useEffect(() => {
    let cancelled = false;
    getHostStatsHistory(24).then((result) => {
      if (!cancelled && result.ok) setHostStats(result.data.points);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // KPI row + busiest-hours heatmap (design 10a) follow the shared day range
  // (365 for anything past the 7/30/90 switcher isn't offered there — 90 caps it).
  useEffect(() => {
    let cancelled = false;
    const range = days === 7 ? 30 : days;
    getAnalyticsKpis(range as 30 | 90).then((result) => {
      if (!cancelled && result.ok) setKpis(result.data);
    });
    getHourHeatmap(range as 30 | 90).then((result) => {
      if (!cancelled && result.ok) setHeatmap(result.data.grid);
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Initial load: everything that doesn't depend on a switcher fetches once, together.
  // `units` no longer needs its own fetch here — it comes from AdminLayout's Outlet
  // context (useAdminContext) — dropping what used to be this page's own dedicated
  // `getMenu()` call purely to read `.units` off an otherwise-unused response (Phase 5
  // Task 0: this page needed no taps snapshot, so its `getMenu()` call was entirely
  // redundant with the one AdminLayout now makes once per admin session).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getPoursByDay(DEFAULT_DAYS),
      getBeersByVolume(DEFAULT_DAYS),
      getHourHistogram(),
      getActiveKegStats(),
      getLeaderboard('week'),
      listMonitors(),
    ]).then(([poursRes, beersRes, hoursRes, kegsRes, leaderboardRes, monitorsRes]) => {
      if (cancelled) return;
      if (poursRes.ok) setPours(poursRes.data);
      if (beersRes.ok) setBeers(beersRes.data);
      if (hoursRes.ok) setHours(hoursRes.data);
      if (kegsRes.ok) setKegs(kegsRes.data);
      if (leaderboardRes.ok) setLeaderboardRows(leaderboardRes.data);
      if (monitorsRes.ok) {
        // One picker entry per physical DEVICE (a 4-port Kegtron is one temperature
        // sensor, not four) — addressed by its anchor row's monitor id; the temps
        // endpoint answers device-wide for any port row. Govee sensors chart too
        // (disabled ones don't); Kegtron devices sort first so a new Govee sensor
        // doesn't silently steal the default chart ('govee_sensor' < 'kegtron_pro'
        // lexically in the listMonitors ordering).
        const chartable = monitorsRes.data.filter((m) =>
          m.type === 'kegtron_pro' || (m.type === 'govee_sensor' && m.enabled));
        const devices = groupMonitors(chartable)
          .sort((a, b) => Number(a.type === 'govee_sensor') - Number(b.type === 'govee_sensor'))
          .map((g) => ({ monitorId: g.anchorId, label: deviceLabel(g) }));
        setProDevices(devices);
        setSelectedMonitorId(devices[0]?.monitorId ?? null);
      }
      const allOk = poursRes.ok && beersRes.ok && hoursRes.ok
        && kegsRes.ok && leaderboardRes.ok && monitorsRes.ok;
      setStatus(allOk ? 'loaded' : 'error');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  // Range switcher: re-fetches pours + beers together whenever `days` changes (including
  // the initial mount value, harmlessly re-requesting what the effect above already
  // fetched — the duplicate call is cheap and keeps this effect the single source of
  // truth for "days changed").
  useEffect(() => {
    let cancelled = false;
    getPoursByDay(days).then((result) => {
      if (!cancelled && result.ok) setPours(result.data);
    });
    getBeersByVolume(days).then((result) => {
      if (!cancelled && result.ok) setBeers(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Leaderboard window switcher.
  useEffect(() => {
    let cancelled = false;
    getLeaderboard(leaderboardWindow).then((result) => {
      if (!cancelled && result.ok) setLeaderboardRows(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [leaderboardWindow]);

  // Temp chart's monitor picker.
  useEffect(() => {
    if (selectedMonitorId == null) {
      setTemps([]);
      return;
    }
    let cancelled = false;
    getStatsTemps(selectedMonitorId).then((result) => {
      if (!cancelled && result.ok) setTemps(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMonitorId]);

  return (
    <section data-testid="admin-stats-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Analytics</h1>
        {status === 'loaded' && (
          <button
            type="button"
            className="admin-page-header__action"
            data-testid="analytics-export-all"
            onClick={() => {
              const payload = JSON.stringify({
                exportedAt: new Date().toISOString(), days, kpis, pours, beers, hours, heatmap, kegs, leaderboard: leaderboardRows,
              }, null, 2);
              const blob = new Blob([payload], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'kegtron-analytics.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export all (JSON)
          </button>
        )}
        {status === 'loaded' && (
          <div className="stats-switcher" role="group" aria-label="Date range" data-testid="stats-range-switcher">
            {DAY_RANGES.map((d) => (
              <button
                key={d}
                type="button"
                className="stats-switcher__option"
                data-testid={`stats-range-${d}`}
                aria-pressed={days === d}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        )}
      </header>

      {status === 'loading' && <p className="admin-page-quiet" data-testid="stats-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="stats-error">
          Couldn&rsquo;t load some stats. Reload to try again.
        </p>
      )}

      {status !== 'loading' && (
        <>
          <nav className="analytics-tabs" role="tablist" aria-label="Analytics sections" data-testid="analytics-tabs">
            {ANALYTICS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                className="analytics-tab"
                data-testid={`analytics-tab-${t.key}`}
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Every panel stays mounted; `hidden` switches tabs so the one-shot fetches keep
              all tabs live and getByTestId/deep-links reach any panel. */}
          <div hidden={tab !== 'overview'} data-testid="analytics-panel-overview">
            {kpis && (
              <div className="analytics-kpis" data-testid="analytics-kpis">
                <div className="dashboard-stat">
                  <span className="dashboard-stat__label">POURS</span>
                  <span className="dashboard-stat__value font-display font-tabular" data-testid="kpi-pours">{kpis.pours.toLocaleString()}</span>
                </div>
                <div className="dashboard-stat">
                  <span className="dashboard-stat__label">VOLUME</span>
                  <span className="dashboard-stat__value font-display font-tabular" data-testid="kpi-volume">{formatVolumeMl(kpis.volumeMl, units)}</span>
                </div>
                <div className="dashboard-stat">
                  <span className="dashboard-stat__label">KEGS KICKED</span>
                  <span className="dashboard-stat__value font-display font-tabular" data-testid="kpi-kicked">{kpis.kegsKicked}</span>
                </div>
                <div className="dashboard-stat">
                  <span className="dashboard-stat__label">COST / PINT</span>
                  <span className="dashboard-stat__value font-display font-tabular" data-testid="kpi-cost">
                    {kpis.costPerPintCents != null ? `$${(kpis.costPerPintCents / 100).toFixed(2)}` : '—'}
                  </span>
                  <span className="dashboard-stat__note">
                    {kpis.valueOnTapCents > 0 ? `$${(kpis.valueOnTapCents / 100).toFixed(0)} of beer on tap` : 'Set keg costs to track'}
                  </span>
                </div>
                <div className="dashboard-stat">
                  <span className="dashboard-stat__label">AVG QUALITY</span>
                  <span className="dashboard-stat__value font-display font-tabular" data-testid="kpi-quality">
                    {kpis.avgQuality != null ? kpis.avgQuality : '—'}
                  </span>
                </div>
              </div>
            )}
            <div className="stats-grid">
              <PoursChart data={pours} units={units} />
            </div>
            {(() => {
              const highlights: string[] = [];
              if (beers[0]) highlights.push(`Top beer: ${beers[0].beerName} · ${formatVolumeMl(beers[0].volumeMl, units)}`);
              const busiest = [...pours].sort((a, b) => b.count - a.count)[0];
              if (busiest && busiest.count > 0) highlights.push(`Busiest day: ${busiest.date} · ${busiest.count} pours`);
              if (leaderboardRows[0]) highlights.push(`Top pourer: ${leaderboardRows[0].displayName} · ${leaderboardRows[0].pourCount} pours`);
              if (kpis?.costPerPintCents != null) highlights.push(`Cost per pint: $${(kpis.costPerPintCents / 100).toFixed(2)}`);
              return highlights.length > 0 ? (
                <section className="stats-section" data-testid="analytics-highlights">
                  <h3 className="stats-chart__title">Highlights</h3>
                  <ul className="analytics-highlights">
                    {highlights.map((h) => (
                      <li key={h} data-testid="analytics-highlight">{h}</li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })()}
          </div>

          <div hidden={tab !== 'pours'} data-testid="analytics-panel-pours">
            {heatmap.length === 7 && (
              <section className="stats-section" data-testid="analytics-heatmap">
                <h3 className="stats-chart__title">Busiest hours</h3>
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
          </div>

          <div hidden={tab !== 'beers'} data-testid="analytics-panel-beers">
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
          </div>

          <div hidden={tab !== 'kegs'} data-testid="analytics-panel-kegs">
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
                              {row.costCents != null ? `$${(row.costCents / 100).toFixed(2)}` : '—'}
                            </td>
                            <td className="font-tabular">
                              {row.pricePerPintCents != null ? `$${(row.pricePerPintCents / 100).toFixed(2)}` : '—'}
                            </td>
                            <td className="font-tabular">{`${row.pouredPct}%`}</td>
                            <td className="font-tabular">
                              {row.valueLeftCents != null ? `$${(row.valueLeftCents / 100).toFixed(2)}` : '—'}
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
                          <td className="font-tabular">{row.month}</td>
                          <td className="font-tabular">{row.kegs}</td>
                          <td className="font-tabular">{`$${(row.spendCents / 100).toFixed(2)}`}</td>
                          <td className="font-tabular">
                            {row.pricePerPintCents != null ? `$${(row.pricePerPintCents / 100).toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          <div hidden={tab !== 'people'} data-testid="analytics-panel-people">
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
          </div>

          <div hidden={tab !== 'temps'} data-testid="analytics-panel-temps">
            <div className="stats-grid">
              <TempChart
                data={temps} units={units} devices={proDevices}
                selectedMonitorId={selectedMonitorId} onSelectMonitor={setSelectedMonitorId}
              />
            </div>
            <section className="stats-section" data-testid="analytics-sensor-history">
              <h3 className="stats-chart__title">Sensor history</h3>
              {sensors.length === 0 ? (
                <p className="admin-page-quiet">No temperature sensors reporting.</p>
              ) : (
                <div className="analytics-table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Sensor</th>
                        <th scope="col">Now</th>
                        <th scope="col">Humidity</th>
                        <th scope="col">7-day min–max</th>
                        <th scope="col">Last reading</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sensors.map((s) => (
                        <tr key={s.id} data-testid="sensor-history-row">
                          <td>{`${s.name} · ${s.kind === 'kegtron' ? 'KEGTRON' : 'GOVEE'}`}</td>
                          <td className="font-tabular">{s.tempC != null ? formatTempC(s.tempC, units) : '—'}</td>
                          <td className="font-tabular">{s.humidity != null ? `${Math.round(s.humidity)}%` : '—'}</td>
                          <td className="font-tabular">
                            {s.min7dC != null && s.max7dC != null ? `${formatTempC(s.min7dC, units)} – ${formatTempC(s.max7dC, units)}` : '—'}
                          </td>
                          <td className="font-tabular">{s.lastSeen ? new Date(s.lastSeen).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div hidden={tab !== 'server'} data-testid="analytics-panel-server">
            <div className="stats-grid">
              <HostStatsChart data={hostStats} units={units} />
            </div>
          </div>

          <div hidden={tab !== 'devices'} data-testid="analytics-panel-devices">
            <section className="stats-section" data-testid="analytics-ingest-sources">
              <h3 className="stats-chart__title">Ingest sources</h3>
              <div className="analytics-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Status</th>
                      <th scope="col">Detail</th>
                      <th scope="col">Last event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.name} data-testid="ingest-source-row">
                        <td>{s.name}</td>
                        <td>{!s.registered ? 'not set up' : s.healthy ? '● OK' : '● down'}</td>
                        <td>{s.detail || '—'}</td>
                        <td className="font-tabular">{s.lastEventAt ? formatRelativeTime(s.lastEventAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="stats-section" data-testid="analytics-udp-devices">
              <h3 className="stats-chart__title">UDP packet coverage · last 24h</h3>
              {udpDevices.length === 0 ? (
                <p className="admin-page-quiet">No UDP packets received in the last 24 hours.</p>
              ) : (
                <div className="analytics-table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Device serial</th>
                        <th scope="col">Packets</th>
                        <th scope="col">Coverage</th>
                        <th scope="col">Gaps</th>
                        <th scope="col">Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {udpDevices.map((d) => (
                        <tr key={d.serial} data-testid="udp-device-row">
                          <td className="font-tabular">{d.serial}</td>
                          <td className="font-tabular">{d.totalPackets.toLocaleString()}</td>
                          <td className="font-tabular">{`${d.coveragePct}%`}</td>
                          <td className="font-tabular">{d.gaps.length}</td>
                          <td className="font-tabular">{formatRelativeTime(d.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div hidden={tab !== 'raw'} data-testid="analytics-panel-raw">
            <section className="stats-section">
              <h3 className="stats-chart__title">Raw datasets</h3>
              <p className="admin-page-quiet">Download the in-view data as CSV. Admin-only sets carry owner cost.</p>
              <div className="raw-export-chips" data-testid="analytics-raw-chips">
                {([
                  ['Pour history', pourHistory],
                  ['Beer history', beerHistory],
                  ['Pourer history', pourerHistory],
                  ['Pours per day', pours],
                  ...(isAdmin ? [
                    ['Keg costs', kegCosts] as const,
                    ['Monthly spend', monthlySpend] as const,
                  ] : []),
                ] as [string, Record<string, unknown>[]][]).map(([label, rows]) => (
                  <button
                    key={label}
                    type="button"
                    className="raw-export-chip"
                    data-testid={`raw-export-${label.toLowerCase().replace(/\s+/g, '-')}`}
                    disabled={rows.length === 0}
                    onClick={() => download(toCsv(rows), `kegwall-${label.toLowerCase().replace(/\s+/g, '-')}.csv`)}
                  >
                    {`${label} · CSV (${rows.length})`}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
