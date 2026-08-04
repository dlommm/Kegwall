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

/** One-metric tooltip: the time, then a single formatted value for whichever chart it's in. */
function MetricTooltip({ active, payload, format }: {
  active?: boolean; payload?: { payload: TelemetryPoint }[]; format: (p: TelemetryPoint) => string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="stats-tooltip" role="tooltip">
      <p className="stats-tooltip__label font-tabular">{formatTimeLabel(point.ts)}</p>
      <p className="stats-tooltip__value font-tabular">{format(point)}</p>
    </div>
  );
}

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 };

/**
 * `/admin/stats`'s environment charts — one Kegtron Pro / Govee sensor's recent readings, shown as
 * TWO separate charts: temperature and humidity. They were once a single dual-Y-axis chart, but
 * temperature (°C/°F) and humidity (%) are unrelated units, and a stacked pair of independently
 * scaled charts reads more cleanly than two lines fighting over one plot. Each uses the brass accent
 * for its own line.
 *
 * Two empty states: no Pro/Govee sensor bound at all (nothing to chart, ever) vs. a real sensor with
 * no readings yet (transient, will fill in).
 */
export function TempChart({
  data, units, devices, selectedMonitorId, onSelectMonitor,
}: TempChartProps) {
  const xAxis = (
    <XAxis
      dataKey="ts" className="font-tabular" tickFormatter={formatTimeLabel}
      tick={{ fill: 'var(--text-dim)', fontSize: 10 }} axisLine={false} tickLine={false}
      interval="preserveStartEnd"
    />
  );
  return (
    <div className="stats-chart" data-testid="temp-chart">
      <div className="stats-chart__header">
        <h3 className="stats-chart__title">Temperature &amp; humidity</h3>
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
        <>
          {/* Temperature — its own chart. */}
          <div className="stats-chart__metric" data-testid="temp-chart-temperature">
            <h4 className="stats-chart__subtitle">Temperature</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                {xAxis}
                <YAxis
                  className="font-tabular" width={40}
                  tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => Math.round(v).toString()}
                />
                <Tooltip content={<MetricTooltip format={(p) => (p.temp != null ? formatTempC(p.temp, units) : 'No reading')} />} />
                <Line
                  type="monotone" dataKey="temp" name="Temperature" stroke="var(--accent)"
                  strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Humidity — its own chart, fixed 0–100% scale. */}
          <div className="stats-chart__metric" data-testid="temp-chart-humidity">
            <h4 className="stats-chart__subtitle">Humidity</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                {xAxis}
                <YAxis
                  className="font-tabular" width={40} domain={[0, 100]}
                  tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<MetricTooltip format={(p) => (p.humidity != null ? `${Math.round(p.humidity)}% humidity` : 'No humidity reading')} />} />
                <Line
                  type="monotone" dataKey="humidity" name="Humidity" stroke="var(--accent)"
                  strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
