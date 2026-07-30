import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import { formatTempC, type VolumeUnits } from '../../lib/units';

export interface TempChartProps {
  data: TelemetryPoint[];
  units: VolumeUnits;
  /** One entry per physical Kegtron Pro DEVICE (StatsPage groups the per-port monitor
   * rows) — `monitorId` is the device's anchor row, `label` its friendly name or
   * identifier. A picker only renders when there's more than one device. */
  devices: { monitorId: number; label: string }[];
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
      <p className="stats-tooltip__value font-tabular">
        {point.humidity != null ? `${Math.round(point.humidity)}% humidity` : 'No humidity reading'}
      </p>
    </div>
  );
}

/**
 * `/admin/stats`'s temperature line chart (Task 9; Phase 5 Task 0 spec-parity item adds
 * humidity) — one Kegtron Pro monitor's recent readings. Brass primary line for
 * temperature (same accent as every other chart on this page); humidity is the muted-gray
 * `var(--text-dim)` treatment the binding style reserves for a secondary/comparison
 * series — it's real telemetry from the exact same device, not the chart's main subject.
 *
 * Humidity gets its OWN (right-side) Y axis rather than sharing temperature's, fixed to a
 * 0-100% domain: temp (°C or °F) and humidity (%) are different units with unrelated
 * numeric ranges, so forcing them onto one axis would either flatten humidity's real
 * variation (if scaled to temp's typically-narrow range) or stretch temp's trend into
 * near-invisibility (if scaled to humidity's fixed 0-100 range) — neither reads honestly.
 * Two independently-scaled axes keep both trends visible on their own terms; the legend
 * + differently-colored lines is what lets a viewer tell which axis is which. This is the
 * project's only two-Y-axis chart, so this justification lives here rather than in a
 * shared charts-style doc.
 *
 * Two empty states: no Pro monitor bound at all (nothing to chart, ever) vs. a real
 * monitor with no readings yet (transient, will fill in).
 */
export function TempChart({
  data, units, devices, selectedMonitorId, onSelectMonitor,
}: TempChartProps) {
  return (
    <div className="stats-chart" data-testid="temp-chart">
      <div className="stats-chart__header">
        <h3 className="stats-chart__title">Temperature</h3>
        {/* A plain HTML legend (not Recharts' own <Legend>) — Recharts' Legend measures
            its own rendered height via getBoundingClientRect to reserve chart space for
            itself, which this project's jsdom test shim (see tests/web/setup.ts) stubs
            uniformly for every element, "eating" the whole chart height in tests. A
            static two-item key next to the title needs no such measurement and is
            simpler for a chart that only ever has exactly two fixed series anyway. */}
        <div className="stats-chart__legend" data-testid="temp-chart-legend">
          <span className="stats-chart__legend-item">
            <span className="stats-chart__legend-swatch" style={{ backgroundColor: 'var(--accent)' }} aria-hidden="true" />
            Temperature
          </span>
          <span className="stats-chart__legend-item">
            <span className="stats-chart__legend-swatch" style={{ backgroundColor: 'var(--text-dim)' }} aria-hidden="true" />
            Humidity
          </span>
        </div>
        {devices.length > 1 && (
          <select
            className="stats-chart__monitor-select"
            data-testid="temp-chart-monitor-select"
            value={selectedMonitorId ?? ''}
            onChange={(e) => onSelectMonitor(Number(e.target.value))}
          >
            {devices.map((d) => (
              <option key={d.monitorId} value={d.monitorId}>{d.label}</option>
            ))}
          </select>
        )}
      </div>
      {devices.length === 0 ? (
        <p className="admin-page-quiet" data-testid="temp-chart-empty">
          No temperature source yet — a trend appears once a Kegtron Pro or Govee sensor reports in.
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
              yAxisId="temp" className="font-tabular" width={40}
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <YAxis
              yAxisId="humidity" orientation="right" className="font-tabular" width={36}
              domain={[0, 100]}
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip content={<TempTooltip units={units} />} />
            <Line
              yAxisId="temp"
              type="monotone" dataKey="temp" name="Temperature" stroke="var(--accent)"
              strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
            />
            <Line
              yAxisId="humidity"
              type="monotone" dataKey="humidity" name="Humidity" stroke="var(--text-dim)"
              strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
