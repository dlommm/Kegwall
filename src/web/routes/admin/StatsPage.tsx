import { useState } from 'react';
import type { VolumeUnits } from '../../lib/units';
import { formatWholeVolume } from '../../lib/lookData';
import { useAdminContext } from './useAdminContext';
import { PageTemplate } from './PageTemplate';
import { Button, Chips, ErrorState, Skeleton, Tabs, tabId } from './ui';
import { DAY_RANGES, useAnalyticsData, type AnalyticsData, type DayRange } from './insights/useAnalyticsData';
import { OverviewPanel } from './insights/OverviewPanel';
import {
  BeersPanel, KegsPanel, PeoplePanel, PoursPanel, type PanelProps,
} from './insights/HistoryPanels';
import {
  DevicesPanel, RawPanel, ServerPanel, TempsPanel,
} from './insights/SystemPanels';
import { download } from './insights/csv';

/** The analytics tabs (WebUI redesign 4e/4j). Every panel stays mounted (tab switches hide
 * via `hidden`) so the one-shot fetches keep every tab live and deep links reach any panel. */
const ANALYTICS_TABS = [
  { key: 'overview', label: 'Overview', Panel: OverviewPanel },
  { key: 'pours', label: 'Pours', Panel: PoursPanel },
  { key: 'beers', label: 'Beers & styles', Panel: BeersPanel },
  { key: 'kegs', label: 'Kegs & cost', Panel: KegsPanel },
  { key: 'people', label: 'People', Panel: PeoplePanel },
  { key: 'temps', label: 'Temps', Panel: TempsPanel },
  { key: 'server', label: 'Server', Panel: ServerPanel },
  { key: 'devices', label: 'Devices & ingest', Panel: DevicesPanel },
  { key: 'raw', label: 'Raw', Panel: RawPanel },
] as const satisfies readonly { key: string; label: string; Panel: (p: PanelProps) => unknown }[];
type AnalyticsTab = (typeof ANALYTICS_TABS)[number]['key'];

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** "Last 30 days: 142 pours, 1,956 oz. Fridays are your busiest." */
export function analyticsHeadline(d: Pick<AnalyticsData, 'kpis' | 'days' | 'heatmap'>, units: VolumeUnits): string {
  if (!d.kpis) return 'Analytics';
  if (d.kpis.pours === 0) return `No pours in the last ${d.days} days.`;
  const first = `Last ${d.days} days: ${d.kpis.pours.toLocaleString()} pour${d.kpis.pours === 1 ? '' : 's'}, ${formatWholeVolume(d.kpis.volumeMl, units)}.`;
  const totals = d.heatmap.map((row) => row.reduce((a, b) => a + b, 0));
  const max = Math.max(0, ...totals);
  if (totals.length !== 7 || max === 0) return first;
  return `${first} ${DAY_NAMES[totals.indexOf(max)]} are your busiest.`;
}

/**
 * `/admin/stats` — Insights › Analytics (Kegwall V2 M8, prototypes/admin-insights.html): a
 * sentence about the range, the 7 / 30 / 90-day switch and an export, then the analytics
 * tabs. Data comes from `useAnalyticsData`; each tab is its own panel component.
 */
export function StatsPage() {
  const { units, me } = useAdminContext();
  const isAdmin = me.role === 'admin';
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const d = useAnalyticsData(isAdmin);
  const { status, days, setDays } = d;

  function exportAll() {
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      days,
      kpis: d.kpis,
      pours: d.pours,
      beers: d.beers,
      hours: d.hours,
      heatmap: d.heatmap,
      kegs: d.kegs,
      leaderboard: d.leaderboardRows,
    }, null, 2);
    download(payload, 'kegtron-analytics.json', 'application/json');
  }

  return (
    <PageTemplate
      testId="admin-stats-page"
      title={analyticsHeadline(d, units)}
      sub={d.beers[0]
        ? `${d.beers[0].beerName} poured the most. Nothing here is estimated except kick dates.`
        : 'Nothing here is estimated except kick dates.'}
      actions={status === 'loaded' && (
        <>
          <Chips<`${DayRange}`>
            label="Date range"
            testId="stats-range-switcher"
            value={`${days}`}
            onChange={(v) => setDays(Number(v) as DayRange)}
            options={DAY_RANGES.map((n) => ({
              value: `${n}` as `${DayRange}`,
              label: <span data-testid={`stats-range-${n}`}>{`${n} days`}</span>,
            }))}
          />
          <Button data-testid="analytics-export-all" onClick={exportAll}>Export</Button>
        </>
      )}
    >
      {status === 'loading' && <div data-testid="stats-loading"><Skeleton height={200} /></div>}
      {status === 'error' && (
        <div data-testid="stats-error">
          <ErrorState title="Couldn’t load some stats.">Reload to try again.</ErrorState>
        </div>
      )}

      {status !== 'loading' && (
        <>
          <Tabs<AnalyticsTab>
            label="Analytics sections"
            idBase="analytics"
            testId="analytics-tabs"
            value={tab}
            onChange={setTab}
            items={ANALYTICS_TABS.map((t) => ({ value: t.key, label: t.label, testId: `analytics-tab-${t.key}` }))}
          />
          {ANALYTICS_TABS.map(({ key, Panel }) => (
            <div
              key={key}
              role="tabpanel"
              aria-labelledby={tabId('analytics', key)}
              hidden={tab !== key}
              data-testid={`analytics-panel-${key}`}
            >
              <Panel d={d} units={units} isAdmin={isAdmin} />
            </div>
          ))}
        </>
      )}
    </PageTemplate>
  );
}
