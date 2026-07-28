import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { BeerVolumeStat } from '../../../server/db/stats.js';
import { srmToColor } from '../../lib/srm';
import { formatVolumeMl, type VolumeUnits } from '../../lib/units';

export interface BeerVolumeChartProps {
  data: BeerVolumeStat[];
  units: VolumeUnits;
}

const GRID_STROKE = 'color-mix(in srgb, var(--text) 10%, transparent)';
const CURSOR_FILL = 'color-mix(in srgb, var(--text) 6%, transparent)';
const ROW_HEIGHT_PX = 36;
const MIN_CHART_HEIGHT_PX = 120;

/** Exported for a direct, hover-free unit test — see the Charts style binding's
 * "tooltips show exact values + units" rule. */
export function formatBeerTooltip(point: BeerVolumeStat, units: VolumeUnits): string {
  const pours = point.pourCount === 1 ? '1 pour' : `${point.pourCount} pours`;
  return `${formatVolumeMl(point.volumeMl, units)} · ${pours}`;
}

function BeerTooltip({ active, payload, units }: {
  active?: boolean; payload?: { payload: BeerVolumeStat }[]; units: VolumeUnits;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="stats-tooltip" role="tooltip">
      <p className="stats-tooltip__label font-tabular">{point.beerName}</p>
      <p className="stats-tooltip__value font-tabular">{formatBeerTooltip(point, units)}</p>
    </div>
  );
}

/**
 * `/admin/stats`'s volume-by-beer chart (Task 9): horizontal bars, one per beer,
 * already sorted descending by volume server-side (see `beersByVolume`, db/stats.ts).
 * This is the ONE stats chart where SRM color is correct to use as the series fill, per
 * the Charts style binding ("SRM colors ONLY when a series maps to a specific beer") —
 * every bar here IS one specific beer, unlike the pours/hour/temp charts, which stay
 * brass.
 */
export function BeerVolumeChart({ data, units }: BeerVolumeChartProps) {
  return (
    <div className="stats-chart" data-testid="beer-volume-chart">
      <h3 className="stats-chart__title">Volume by beer</h3>
      {data.length === 0 ? (
        <p className="admin-page-quiet" data-testid="beer-volume-empty">
          No pours recorded yet — volume by beer will appear here once the taps start pouring.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(MIN_CHART_HEIGHT_PX, data.length * ROW_HEIGHT_PX)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis
              type="number" className="font-tabular"
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
            />
            <YAxis
              type="category" dataKey="beerName" width={110} className="font-tabular"
              tick={{ fill: 'var(--text)', fontSize: 11 }} axisLine={false} tickLine={false}
            />
            <Tooltip content={<BeerTooltip units={units} />} cursor={{ fill: CURSOR_FILL }} />
            <Bar dataKey="volumeMl" name="Volume" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {data.map((entry) => (
                <Cell key={entry.beerName} fill={srmToColor(entry.srm).liquid} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
