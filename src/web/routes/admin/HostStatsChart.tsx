import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HostStatsHistoryPoint } from '../../lib/adminApi';
import { formatTempC, type VolumeUnits } from '../../lib/units';
import { formatTimeLabel } from './TempChart';
import { GRID_STROKE, TICK } from '../../design/chartTheme';

export interface HostStatsChartProps {
  data: HostStatsHistoryPoint[];
  units: VolumeUnits;
}


function HostStatsTooltip({ active, payload, units }: {
  active?: boolean; payload?: { payload: HostStatsHistoryPoint }[]; units: VolumeUnits;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="stats-tooltip" role="tooltip">
      <p className="stats-tooltip__label font-tabular">{formatTimeLabel(p.ts)}</p>
      <p className="stats-tooltip__value font-tabular">{`CPU ${Math.round(p.cpuPct)}% · RAM ${Math.round(p.memPct)}%`}</p>
      <p className="stats-tooltip__value font-tabular">
        {p.diskPct != null ? `Disk ${Math.round(p.diskPct)}%` : 'No disk figure'}
        {p.tempC != null ? ` · ${formatTempC(p.tempC, units)}` : ''}
        {p.watts != null ? ` · ${p.watts} W` : ''}
      </p>
    </div>
  );
}

/**
 * `/admin/stats`'s server-health chart (Pi monitoring epic): the 60s host sampler's
 * history — CPU / RAM / disk on one shared 0-100% axis (all three ARE percentages,
 * unlike TempChart's mixed-unit pair, so one axis reads honestly). Temperature and
 * watts stay tooltip-only rather than adding a third/fourth axis nobody can read.
 */
export function HostStatsChart({ data, units }: HostStatsChartProps) {
  return (
    <div className="stats-chart" data-testid="host-stats-chart">
      <div className="stats-chart__header">
        <h3 className="stats-chart__title">Server health</h3>
        <div className="stats-chart__legend" data-testid="host-stats-chart-legend">
          <span className="stats-chart__legend-item">
            <span className="stats-chart__legend-swatch" style={{ backgroundColor: 'var(--accent)' }} aria-hidden="true" />
            CPU
          </span>
          <span className="stats-chart__legend-item">
            <span className="stats-chart__legend-swatch" style={{ backgroundColor: 'var(--ok)' }} aria-hidden="true" />
            RAM
          </span>
          <span className="stats-chart__legend-item">
            <span className="stats-chart__legend-swatch" style={{ backgroundColor: 'var(--text-dim)' }} aria-hidden="true" />
            Disk
          </span>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="admin-page-quiet" data-testid="host-stats-chart-empty">
          No samples yet — the server records one per minute while it runs.
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
              className="font-tabular" width={40} domain={[0, 100]}
              tick={TICK} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip content={<HostStatsTooltip units={units} />} />
            <Line type="monotone" dataKey="cpuPct" name="CPU" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="memPct" name="RAM" stroke="var(--ok)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="diskPct" name="Disk" stroke="var(--text-dim)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
