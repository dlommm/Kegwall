import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HourHistogram } from '../../../server/db/stats.js';

export interface HourHistogramRowProps {
  data: HourHistogram[];
}

const GRID_STROKE = 'color-mix(in srgb, var(--text) 10%, transparent)';
const CURSOR_FILL = 'color-mix(in srgb, var(--text) 6%, transparent)';

/** `0` -> `12a`, `9` -> `9a`, `12` -> `12p`, `18` -> `6p` — a compact 12-hour label for
 * the hour-of-day axis. `hour` already arrives as the SERVER's local hour (`hourHistogram`
 * in db/stats.ts converts server-side via SQLite's `localtime` modifier — see that
 * function's doc comment), so this is just formatting a plain 0-23 number; no further
 * timezone conversion happens client-side. */
export function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'a' : 'p';
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}${suffix}`;
}

function HourTooltip({ active, payload }: { active?: boolean; payload?: { payload: HourHistogram }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  const pours = point.count === 1 ? '1 pour' : `${point.count} pours`;
  return (
    <div className="stats-tooltip" role="tooltip">
      <p className="stats-tooltip__label font-tabular">{formatHourLabel(point.hour)}</p>
      <p className="stats-tooltip__value font-tabular">{pours}</p>
    </div>
  );
}

/**
 * `/admin/stats`'s hour-of-day bar row (Task 9) — which hours the taps are busiest,
 * over the trailing 30 days. Same brass/no-animation/tabular-axis/exact-tooltip
 * treatment as `PoursChart`; empty state fires on the total across all 24 hours, since
 * `hourHistogram` always returns all 24 zero-filled (see db/stats.ts).
 */
export function HourHistogramRow({ data }: HourHistogramRowProps) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <div className="stats-chart" data-testid="hour-histogram">
      <h3 className="stats-chart__title">Busiest hours (last 30 days)</h3>
      {total === 0 ? (
        <p className="admin-page-quiet" data-testid="hour-histogram-empty">
          No pours in the last 30 days yet — the busiest hours will appear here once there&rsquo;s data.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="hour" className="font-tabular" tickFormatter={formatHourLabel}
              tick={{ fill: 'var(--text-dim)', fontSize: 10 }} axisLine={false} tickLine={false}
              interval={2}
            />
            <YAxis
              allowDecimals={false} className="font-tabular" width={24}
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
            />
            <Tooltip content={<HourTooltip />} cursor={{ fill: CURSOR_FILL }} />
            <Bar dataKey="count" name="Pours" fill="var(--accent)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
