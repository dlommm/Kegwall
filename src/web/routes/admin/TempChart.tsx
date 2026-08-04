import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import { formatTempC, type VolumeUnits } from '../../lib/units';

export interface TempChartSensor {
  /** The device's anchor monitor row id — the key the telemetry endpoint is addressed by. */
  monitorId: number;
  /** Friendly device name (or identifier when unnamed) — the section heading. */
  label: string;
  data: TelemetryPoint[];
}

export interface TempChartProps {
  units: VolumeUnits;
  /** One entry per enabled temperature DEVICE (a 4-port Kegtron is one sensor, not
   * four), each charted in its own section — no picker, so two fridges can be compared
   * side by side rather than one at a time. */
  sensors: TempChartSensor[];
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

/**
 * The temperature axis's tick label — a real degree reading in the viewer's units
 * (`4°C` / `39°F`). The axis used to print the bare rounded number, which reads as a
 * meaningless "0…6" scale unless you already know which unit the chart is in.
 */
export function formatTempTick(v: number, units: VolumeUnits): string {
  return formatTempC(v, units);
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

function TimeAxis() {
  return (
    <XAxis
      dataKey="ts" className="font-tabular" tickFormatter={formatTimeLabel}
      tick={{ fill: 'var(--text-dim)', fontSize: 10 }} axisLine={false} tickLine={false}
      interval="preserveStartEnd"
    />
  );
}

/**
 * One sensor's readings: temperature and humidity as TWO separate charts. They were once a
 * single dual-Y-axis chart, but temperature (°C/°F) and humidity (%) are unrelated units, and
 * a stacked pair of independently scaled charts reads more cleanly than two lines fighting
 * over one plot. The temperature axis labels real degrees in the viewer's units (`39°F`), not
 * bare numbers — a raw "0…6" scale is unreadable without knowing which unit it's in.
 */
function SensorCharts({ data, units }: { data: TelemetryPoint[]; units: VolumeUnits }) {
  return (
    <>
      <div className="stats-chart__metric" data-testid="temp-chart-temperature">
        <h4 className="stats-chart__subtitle">Temperature</h4>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            {TimeAxis()}
            <YAxis
              className="font-tabular" width={52}
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => formatTempTick(v, units)}
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
            {TimeAxis()}
            <YAxis
              className="font-tabular" width={52} domain={[0, 100]}
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
  );
}

/**
 * `/admin/stats`'s environment charts — ONE titled section per temperature sensor (Kegtron Pro
 * probe or Govee sensor), each with its own temperature + humidity pair. Every enabled sensor
 * charts at once: a picker only ever showed one fridge, which is the wrong shape for a wall
 * with a keezer and a cellar sensor reporting different things.
 *
 * Two empty states: no sensor bound at all (nothing to chart, ever) vs. a real sensor with no
 * readings yet (transient, will fill in) — the latter is per section.
 */
export function TempChart({ units, sensors }: TempChartProps) {
  if (sensors.length === 0) {
    return (
      <div className="stats-chart" data-testid="temp-chart">
        <div className="stats-chart__header">
          <h3 className="stats-chart__title">Temperature &amp; humidity</h3>
        </div>
        <p className="admin-page-quiet" data-testid="temp-chart-empty">
          No temperature source yet — a trend appears once a Kegtron Pro or Govee sensor reports in.
        </p>
      </div>
    );
  }
  return (
    <>
      {sensors.map((sensor) => (
        <div className="stats-chart" data-testid="temp-chart" key={sensor.monitorId}>
          <div className="stats-chart__header">
            <h3 className="stats-chart__title" data-testid="temp-chart-sensor-name">{sensor.label}</h3>
          </div>
          {sensor.data.length === 0 ? (
            <p className="admin-page-quiet" data-testid="temp-chart-no-data">
              No temperature readings yet for this sensor.
            </p>
          ) : (
            <SensorCharts data={sensor.data} units={units} />
          )}
        </div>
      ))}
    </>
  );
}
