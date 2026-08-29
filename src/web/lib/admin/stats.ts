// --- Task 9: stats (+ Phase 6: analytics) ---
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import type {
  PoursByDay, HourHistogram, KegBurnStat, BeerVolumeStat, LeaderboardEntry,
} from '../../../server/db/stats.js';
import { request, type ApiResult } from '../adminHttp';

/** GET /api/stats/pours?days= — pour count + volume per day, zero-filled, feeding the
 * Stats page's pours/day bar chart. `days` is one of the range switcher's three values
 * (server 400s on anything else — see routes/stats.ts). */
export function getPoursByDay(days: 7 | 30 | 90): Promise<ApiResult<PoursByDay[]>> {
  return request(`/api/stats/pours?days=${days}`);
}

/** GET /api/stats/hours — pour count by the SERVER's local hour-of-day (see
 * `hourHistogram` in db/stats.ts) over the trailing 30 days, always all 24 hours. Feeds
 * the Stats page's hour-of-day bar row. */
export function getHourHistogram(): Promise<ApiResult<HourHistogram[]>> {
  return request('/api/stats/hours');
}

/** GET /api/stats/kegs — every currently-on_tap keg's level, remaining volume, trailing-
 * 7-day burn rate, and projected kick date. Feeds the Stats page's per-keg depletion
 * cards. */
export function getActiveKegStats(): Promise<ApiResult<KegBurnStat[]>> {
  return request('/api/stats/kegs');
}

/** GET /api/stats/beers?days= — total volume + pour count per beer over the trailing
 * `days` days, descending by volume. Feeds the Stats page's volume-by-beer bars. */
export function getBeersByVolume(days: 7 | 30 | 90): Promise<ApiResult<BeerVolumeStat[]>> {
  return request(`/api/stats/beers?days=${days}`);
}

/** GET /api/stats/temps?monitorId=&hours= — a Kegtron Pro monitor's recent temp/humidity
 * readings for the Stats page's temp line chart; `hours` defaults to 48 server-side when
 * omitted (a wider window than the Monitors page's own 24h detail panel — see
 * `getMonitorTelemetry` in ./monitors.ts — since the Stats page's chart is meant to show
 * a real multi-day trend, not just "what's it doing right now"). */
export function getStatsTemps(monitorId: number, hours = 48): Promise<ApiResult<TelemetryPoint[]>> {
  return request(`/api/stats/temps?monitorId=${monitorId}&hours=${hours}`);
}

/** GET /api/stats/leaderboard?window= — pour count + volume per drinker, claimed pours
 * only, descending by volume. Feeds the Stats page's leaderboard table. */
export function getLeaderboard(window: 'week' | 'month' | 'all'): Promise<ApiResult<LeaderboardEntry[]>> {
  return request(`/api/stats/leaderboard?window=${window}`);
}

// --- Pour Wall overhaul Phase 6: analytics ----------------------------------

export type {
  AnalyticsKpis, PoursByDay, KegBurnStat, KegCostRow, PourHistoryRow, MonthlySpendRow,
  BeerHistoryRow, PourerHistoryRow,
} from '../../../server/db/stats.js';

/** GET /api/stats/beer-history — lifetime per-beer table (analytics Beers tab). */
export function getBeerHistory(): Promise<ApiResult<import('../../../server/db/stats.js').BeerHistoryRow[]>> {
  return request('/api/stats/beer-history');
}

/** GET /api/stats/pourer-history — lifetime per-pourer table (analytics People tab). */
export function getPourerHistory(): Promise<ApiResult<import('../../../server/db/stats.js').PourerHistoryRow[]>> {
  return request('/api/stats/pourer-history');
}

/** GET /api/stats/keg-costs — per-keg owner-cost breakdown for the analytics Kegs tab.
 *  ADMIN ONLY (owner cost). */
export function getKegCosts(): Promise<ApiResult<import('../../../server/db/stats.js').KegCostRow[]>> {
  return request('/api/stats/keg-costs');
}

/** GET /api/stats/monthly-spend — owner spend by month (analytics Kegs tab). ADMIN ONLY. */
export function getMonthlySpend(): Promise<ApiResult<import('../../../server/db/stats.js').MonthlySpendRow[]>> {
  return request('/api/stats/monthly-spend');
}

/** GET /api/stats/pour-history?days= — recent pours w/ beer/tap/drinker (analytics Pours tab). */
export function getPourHistory(days: 7 | 30 | 90): Promise<ApiResult<import('../../../server/db/stats.js').PourHistoryRow[]>> {
  return request(`/api/stats/pour-history?days=${days}`);
}

/** GET /api/stats/kpis — the Analytics KPI row (design 10a). */
export function getAnalyticsKpis(days: 7 | 30 | 90 | 365 = 30): Promise<ApiResult<import('../../../server/db/stats.js').AnalyticsKpis>> {
  return request(`/api/stats/kpis?days=${days}`);
}

/** GET /api/stats/heatmap — day-of-week × hour pour counts (design 10a). */
export function getHourHeatmap(days: 7 | 30 | 90 | 365 = 30): Promise<ApiResult<{ grid: number[][] }>> {
  return request(`/api/stats/heatmap?days=${days}`);
}
