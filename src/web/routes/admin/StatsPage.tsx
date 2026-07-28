import { useEffect, useState } from 'react';
import type {
  PoursByDay, HourHistogram, KegBurnStat, BeerVolumeStat, LeaderboardEntry,
} from '../../../server/db/stats.js';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import type { Monitor } from '../../../server/db/monitors.js';
import { getMenu } from '../../lib/api';
import {
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume,
  getStatsTemps, getLeaderboard, listMonitors,
} from '../../lib/adminApi';
import type { VolumeUnits } from '../../lib/units';
import { PoursChart } from './PoursChart';
import { HourHistogramRow } from './HourHistogramRow';
import { KegDepletionCards } from './KegDepletionCards';
import { BeerVolumeChart } from './BeerVolumeChart';
import { TempChart } from './TempChart';
import { Leaderboard, type LeaderboardWindow } from './Leaderboard';

/** The pours/beers range switcher's three values — Task 9's plan specifies exactly
 * these three, both server-side (routes/stats.ts 400s on anything else) and here. */
const DAY_RANGES = [7, 30, 90] as const;
type DayRange = (typeof DAY_RANGES)[number];
const DEFAULT_DAYS: DayRange = 30;

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
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  const [days, setDays] = useState<DayRange>(DEFAULT_DAYS);
  const [pours, setPours] = useState<PoursByDay[]>([]);
  const [beers, setBeers] = useState<BeerVolumeStat[]>([]);
  const [hours, setHours] = useState<HourHistogram[]>([]);
  const [kegs, setKegs] = useState<KegBurnStat[]>([]);

  const [proMonitors, setProMonitors] = useState<Monitor[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [temps, setTemps] = useState<TelemetryPoint[]>([]);

  const [leaderboardWindow, setLeaderboardWindow] = useState<LeaderboardWindow>('week');
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardEntry[]>([]);

  // Initial load: everything that doesn't depend on a switcher fetches once, together.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getMenu(),
      getPoursByDay(DEFAULT_DAYS),
      getBeersByVolume(DEFAULT_DAYS),
      getHourHistogram(),
      getActiveKegStats(),
      getLeaderboard('week'),
      listMonitors(),
    ]).then(([menu, poursRes, beersRes, hoursRes, kegsRes, leaderboardRes, monitorsRes]) => {
      if (cancelled) return;
      if (menu.ok) setUnits(menu.data.units ?? 'us');
      if (poursRes.ok) setPours(poursRes.data);
      if (beersRes.ok) setBeers(beersRes.data);
      if (hoursRes.ok) setHours(hoursRes.data);
      if (kegsRes.ok) setKegs(kegsRes.data);
      if (leaderboardRes.ok) setLeaderboardRows(leaderboardRes.data);
      if (monitorsRes.ok) {
        const pros = monitorsRes.data.filter((m) => m.type === 'kegtron_pro');
        setProMonitors(pros);
        setSelectedMonitorId(pros[0]?.id ?? null);
      }
      const allOk = menu.ok && poursRes.ok && beersRes.ok && hoursRes.ok
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
        <h1 className="admin-page-header__title font-display">Stats</h1>
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
        <div className="stats-grid">
          <PoursChart data={pours} units={units} />
          <HourHistogramRow data={hours} />
          <KegDepletionCards data={kegs} units={units} />
          <BeerVolumeChart data={beers} units={units} />
          <TempChart
            data={temps} units={units} monitors={proMonitors}
            selectedMonitorId={selectedMonitorId} onSelectMonitor={setSelectedMonitorId}
          />
          <Leaderboard
            data={leaderboardRows} units={units} window={leaderboardWindow}
            onWindowChange={setLeaderboardWindow}
          />
        </div>
      )}
    </section>
  );
}
