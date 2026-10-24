import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { PoursByDay } from '../../../server/db/stats.js';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';
import {
  CURSOR_FILL, GRID_STROKE, LEAD_MARK, QUIET_MARK, TICK,
} from '../../design/chartTheme';

export interface PoursChartProps {
  data: PoursByDay[];
  units: VolumeUnits;
}

/** `2026-07-27` -> `Jul 27` — UTC, matching how `poursByDay` (db/stats.ts) buckets days,
 * so a tick's label always names the exact calendar day its bar aggregates. */
function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The weekday (0 = Sunday) with the most pours in the range, or null with none. Its bars are
 * the ones the page's sentence names ("Fridays are your busiest"), so they lead in copper. */
export function busiestWeekday(data: PoursByDay[]): number | null {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of data) totals[new Date(`${d.date}T00:00:00Z`).getUTCDay()]! += d.count;
  const max = Math.max(...totals);
  return max > 0 ? totals.indexOf(max) : null;
}

/** Exported for a direct, hover-free unit test — see the Charts style binding's
 * "tooltips show exact values + units" rule. */
export function formatPoursTooltip(point: PoursByDay, units: VolumeUnits): string {
  const pours = point.count === 1 ? '1 pour' : `${point.count} pours`;
  return `${pours} · ${formatVolumeMl(point.volumeMl, units)}`;
}

function PoursTooltip({ active, payload, units }: {
  active?: boolean; payload?: { payload: PoursByDay }[]; units: VolumeUnits;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="stats-tooltip" role="tooltip">
      <p className="stats-tooltip__label font-tabular">{formatShortDate(point.date)}</p>
      <p className="stats-tooltip__value font-tabular">{formatPoursTooltip(point, units)}</p>
    </div>
  );
}

/**
 * `/admin/stats`'s pours/day bar chart (Task 9). Brass primary series, no gradients/3D/
 * decorative animation, tabular-numeral axis labels, exact-value tooltip — per the Charts
 * style binding. The empty state fires on TOTAL count, not `data.length` — `poursByDay`
 * always returns one zero-filled row per day in range (see db/stats.ts), so an all-zero
 * range would otherwise render a flat row of invisible bars instead of saying what's
 * missing.
 */
export function PoursChart({ data, units }: PoursChartProps) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const lead = busiestWeekday(data);
  const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const peak = data.reduce<PoursByDay | null>((best, d) => (!best || d.count > best.count ? d : best), null);
  // Only Mondays are labelled, so a month of bars doesn't crowd its axis.
  const mondays = data.length > 10 ? data.filter((d) => weekday(d.date) === 1).map((d) => d.date) : undefined;
  return (
    <div className="stats-chart" data-testid="pours-chart">
      <h3 className="stats-chart__title">Pours per day</h3>
      {total === 0 ? (
        <p className="admin-page-quiet" data-testid="pours-chart-empty">
          No pours recorded yet — daily pour counts will appear here once the taps start pouring.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="date" className="font-tabular" tickFormatter={formatShortDate}
              tick={TICK} axisLine={false} tickLine={false}
              ticks={mondays}
              interval={mondays ? 0 : 'preserveStartEnd'}
            />
            <YAxis
              allowDecimals={false} className="font-tabular" width={28}
              tick={TICK} axisLine={false} tickLine={false}
            />
            <Tooltip content={<PoursTooltip units={units} />} cursor={{ fill: CURSOR_FILL }} />
            <Bar dataKey="count" name="Pours" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.date} fill={weekday(d.date) === lead ? LEAD_MARK : QUIET_MARK} data-lead={weekday(d.date) === lead || undefined} />
              ))}
              <LabelList
                dataKey="date"
                position="top"
                className="font-tabular"
                fill="var(--text)"
                fontSize={12}
                formatter={(date: unknown) => (peak && date === peak.date ? `${SHORT_DAYS[weekday(peak.date)]} · ${peak.count}` : '')}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
