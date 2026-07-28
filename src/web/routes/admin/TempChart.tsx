import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import type { Monitor } from '../../../server/db/monitors.js';
import { formatTempC, type VolumeUnits } from '../../lib/units';

export interface TempChartProps {
  data: TelemetryPoint[];
  units: VolumeUnits;
  /** Kegtron Pro monitors only — pre-filtered by the caller (`StatsPage`). A picker only
   * renders when there's more than one, per the Task 9 plan. */
  monitors: Monitor[];
  selectedMonitorId: number | null;
  onSelectMonitor: (id: number) => void;
}

const GRID_STROKE = 'color-mix(in srgb, var(--text) 10%, transparent)';

/**
 * `2026-07-27T13:30:00.000Z` -> `1:30 PM` — read directly off the ISO string's UTC
 * hour/minute (no `Date`/`Intl` timezone conversion), the same "stay in UTC, stay
 * deterministic" choice `db/stats.ts` documents for its own day/hour bucketing — a
 * browser-local reading would drift the axis by the viewer's own offset from whatever
 * clock actually reported the temperature.
 */
export function formatTimeLabel(ts: string): string {
  const hour = Number(ts.slice(11, 13));
  const minute = ts.slice(14, 16);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${minute} ${suffix}`;
}

function TempTooltip({ active, payload, units }: {
  active?: boolean; payload?: { payload: TelemetryPoint }[]; units: VolumeUnits;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="stats-tooltip" role="tooltip">
      <p className="stats-tooltip__label font-tabular">{formatTimeLabel(point.ts)}</p>
      <p className="stats-tooltip__value font-tabular">
        {point.temp != null ? formatTempC(point.temp, units) : 'No reading'}
      </p>
    </div>
  );
}

/**
 * `/admin/stats`'s temperature line chart (Task 9) — one Kegtron Pro monitor's recent
 * readings. Brass primary line (same accent as every other chart on this page — a single
 * monitor's temp trend isn't a "comparison series" that would call for the binding
 * style's muted-gray treatment). Two empty states: no Pro monitor bound at all (nothing
 * to chart, ever) vs. a real monitor with no readings yet (transient, will fill in).
 */
export function TempChart({
  data, units, monitors, selectedMonitorId, onSelectMonitor,
}: TempChartProps) {
  return (
    <div className="stats-chart" data-testid="temp-chart">
      <div className="stats-chart__header">
        <h3 className="stats-chart__title">Temperature</h3>
        {monitors.length > 1 && (
          <select
            className="stats-chart__monitor-select"
            data-testid="temp-chart-monitor-select"
            value={selectedMonitorId ?? ''}
            onChange={(e) => onSelectMonitor(Number(e.target.value))}
          >
            {monitors.map((m) => (
              <option key={m.id} value={m.id}>{m.identifier}</option>
            ))}
          </select>
        )}
      </div>
      {monitors.length === 0 ? (
        <p className="admin-page-quiet" data-testid="temp-chart-empty">
          No Kegtron Pro monitor bound yet — a temperature trend will appear here once one reports in.
        </p>
      ) : data.length === 0 ? (
        <p className="admin-page-quiet" data-testid="temp-chart-no-data">
          No temperature readings yet for this monitor.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="ts" className="font-tabular" tickFormatter={formatTimeLabel}
              tick={{ fill: 'var(--text-dim)', fontSize: 10 }} axisLine={false} tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              className="font-tabular" width={40}
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <Tooltip content={<TempTooltip units={units} />} />
            <Line
              type="monotone" dataKey="temp" name="Temperature" stroke="var(--accent)"
              strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
