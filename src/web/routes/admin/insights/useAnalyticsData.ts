import { useEffect, useState } from 'react';
import type {
  PoursByDay, HourHistogram, KegBurnStat, BeerVolumeStat, LeaderboardEntry, AnalyticsKpis,
} from '../../../../server/db/stats.js';
import type { TelemetryPoint } from '../../../../server/db/telemetry.js';
import {
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume,
  getStatsTemps, getLeaderboard, listMonitors, getAnalyticsKpis, getHourHeatmap,
  getHostStatsHistory, getKegCosts, getMonthlySpend, getPourHistory,
  getBeerHistory, getPourerHistory, getSensors, getSources, doctorUdpHistory,
  type HostStatsHistoryPoint, type KegCostRow, type MonthlySpendRow, type PourHistoryRow,
  type BeerHistoryRow, type PourerHistoryRow, type SensorSummary, type UdpDeviceHistory,
} from '../../../lib/adminApi';
import type { SourceStatus } from '../../../../server/ingest/manager.js';
import { groupMonitors, deviceLabel } from '../../../lib/monitorDevices';
import type { LeaderboardWindow } from '../Leaderboard';

/** The range switcher's three values — the server 400s on anything else. */
export const DAY_RANGES = [7, 30, 90] as const;
export type DayRange = (typeof DAY_RANGES)[number];
export const DEFAULT_DAYS: DayRange = 30;

/**
 * Everything the Insights › Analytics page shows, fetched the way StatsPage always did (split
 * out in Kegwall V2 M8): one day range (7/30/90) drives pours, beers, the pour history, the
 * KPIs and the heatmap together; the leaderboard has its own week/month/all window; owner
 * costs load only for admins (the endpoints 403 otherwise); and each temperature sensor is
 * fetched once the device list is known.
 */
export function useAnalyticsData(isAdmin: boolean) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [kegCosts, setKegCosts] = useState<KegCostRow[]>([]);
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpendRow[]>([]);
  const [pourHistory, setPourHistory] = useState<PourHistoryRow[]>([]);
  const [beerHistory, setBeerHistory] = useState<BeerHistoryRow[]>([]);
  const [pourerHistory, setPourerHistory] = useState<PourerHistoryRow[]>([]);
  const [sensors, setSensors] = useState<SensorSummary[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [udpDevices, setUdpDevices] = useState<UdpDeviceHistory[]>([]);
  /** True when nothing arrived in the last 24h and the rows below come from the wider
   *  14-day retention window — i.e. the stream is dead, not merely quiet. */
  const [udpStale, setUdpStale] = useState(false);

  const [days, setDays] = useState<DayRange>(DEFAULT_DAYS);
  const [pours, setPours] = useState<PoursByDay[]>([]);
  const [beers, setBeers] = useState<BeerVolumeStat[]>([]);
  const [hours, setHours] = useState<HourHistogram[]>([]);
  const [kegs, setKegs] = useState<KegBurnStat[]>([]);

  const [sensorDevices, setSensorDevices] = useState<{ monitorId: number; label: string }[]>([]);
  const [tempsByMonitor, setTempsByMonitor] = useState<Record<number, TelemetryPoint[]>>({});

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
    // 24h is the useful window when the stream is alive. When it's empty, ask again over
    // the full 14-day retention: a stream that died three days ago and one that never
    // worked at all are the same blank panel otherwise, and they need opposite fixes.
    doctorUdpHistory(24).then(async (result) => {
      if (cancelled || !result.ok) return;
      if (result.data.devices.length > 0) {
        setUdpDevices(result.data.devices);
        return;
      }
      const wider = await doctorUdpHistory(24 * 14);
      if (!cancelled && wider.ok && wider.data.devices.length > 0) {
        setUdpDevices(wider.data.devices);
        setUdpStale(true);
      }
    });
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

  // KPI row + busiest-hours heatmap (design 10a) follow the shared day range: the server's
  // `/api/stats/kpis` + `/api/stats/heatmap` accept the same 7/30/90/365 windows as the
  // charts (routes/featurePack.ts's rangeSchema), so every figure on this tab describes
  // the same trailing window the switcher names. The KPI caption still states the window
  // explicitly so the row can never silently drift from the charts again.
  useEffect(() => {
    let cancelled = false;
    getAnalyticsKpis(days).then((result) => {
      if (!cancelled && result.ok) setKpis(result.data);
    });
    getHourHeatmap(days).then((result) => {
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
        // One chart section per physical DEVICE (a 4-port Kegtron is one temperature
        // sensor, not four) — addressed by its anchor row's monitor id; the temps
        // endpoint answers device-wide for any port row. Disabled devices (hardware at
        // another location) chart nowhere; Kegtron devices sort first so the serving-temp
        // reference reads before the room sensors.
        const chartable = monitorsRes.data.filter((m) =>
          m.enabled && (m.type === 'kegtron_pro' || m.type === 'govee_sensor'));
        setSensorDevices(groupMonitors(chartable)
          .sort((a, b) => Number(a.type === 'govee_sensor') - Number(b.type === 'govee_sensor'))
          .map((g) => ({ monitorId: g.anchorId, label: deviceLabel(g) })));
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

  // Every sensor charts at once, so every sensor's readings are fetched — one request per
  // device, in parallel, keyed by the device's anchor monitor id.
  useEffect(() => {
    let cancelled = false;
    Promise.all(sensorDevices.map((d) => getStatsTemps(d.monitorId).then(
      (result) => [d.monitorId, result.ok ? result.data : []] as const,
    ))).then((entries) => {
      if (!cancelled) setTempsByMonitor(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [sensorDevices]);

  return {
    status,
    kegCosts,
    monthlySpend,
    pourHistory,
    beerHistory,
    pourerHistory,
    sensors,
    sources,
    udpDevices,
    udpStale,
    days,
    pours,
    beers,
    hours,
    kegs,
    sensorDevices,
    tempsByMonitor,
    leaderboardWindow,
    leaderboardRows,
    kpis,
    heatmap,
    hostStats,
    setDays,
    setLeaderboardWindow,
  };
}

export type AnalyticsData = ReturnType<typeof useAnalyticsData>;
