import type { TelemetryPoint } from '../../../../server/db/telemetry.js';
import type { MonitorDeviceGroup } from '../../../lib/monitorDevices';
import { formatRelativeTime } from '../../../lib/useRelativeTime';
import { formatTempC, type VolumeUnits } from '../../../lib/units';
import { Button } from '../ui';
import { monitorFirmware, monitorOnlineFromMeta } from './monitorText';

/** How far back the device detail's temp/humidity sparklines look — matches
 * `GET /api/monitors/:id/telemetry`'s own default window. */
export const TELEMETRY_HOURS = 24;

export interface TelemetryEntry { status: 'loading' | 'loaded' | 'error'; points: TelemetryPoint[] }
export interface RssiEntry { status: 'loading' | 'loaded' | 'error'; rssi: number | null; error: string | null }

/** A tiny inline `<svg><polyline>` sparkline. Renders a quiet "not enough data" note until
 * there are at least two numeric samples to draw a line between. Null samples (a sensor
 * with no humidity, or a gap in reporting) are skipped rather than plotted as zero. */
function Sparkline({ values, testId, label }: { values: (number | null)[]; testId: string; label: string }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) {
    return (
      <p className="adm-sub" data-testid={`${testId}-empty`}>
        Not enough readings yet for a trend line.
      </p>
    );
  }
  const width = 240;
  const height = 48;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const points = nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className="monitor-v2__spark"
      data-testid={testId}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label} over the last ${TELEMETRY_HOURS} hours`}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * One device's details (Pro and Govee), shown in the Monitors drawer: firmware and online
 * state from cloud-discovery meta, an on-demand WiFi check (one per device; `GetWiFiRssi`
 * takes no port), and the last 24 h of temperature and humidity.
 */
export function DeviceDetails({
  group, units, canEdit, telemetry, rssi, onCheckRssi,
}: {
  group: MonitorDeviceGroup;
  units: VolumeUnits;
  canEdit: boolean;
  telemetry: TelemetryEntry | undefined;
  rssi: RssiEntry | undefined;
  onCheckRssi: () => void;
}) {
  const anchor = group.ports[0]!;
  const isPro = group.type === 'kegtron_pro';
  const online = monitorOnlineFromMeta(anchor);
  return (
    <div className="adm-form" data-testid="monitors-card-details">
      {isPro && (
        <dl className="adm-facts" data-testid="monitors-device-info">
          <dt>Firmware</dt>
          <dd data-testid="monitors-device-firmware">{monitorFirmware(anchor) ?? 'Unknown'}</dd>
          <dt>Kegtron cloud</dt>
          <dd data-testid="monitors-device-online" data-online={online ?? undefined}>
            {online === null ? 'Unknown' : online ? 'Online' : 'Offline'}
          </dd>
          <dt>WiFi signal</dt>
          <dd>
            {rssi?.status === 'loaded' && <span data-testid="monitors-rssi-value">{rssi.rssi} dBm</span>}
            {rssi?.status === 'error' && (
              <span className="adm-danger-text" role="alert" data-testid="monitors-rssi-error">{rssi.error}</span>
            )}
            {!rssi && 'Not checked'}
            {rssi?.status === 'loading' && 'Checking…'}
          </dd>
        </dl>
      )}
      {isPro && canEdit && (
        <Button
          data-testid="monitors-rssi-check"
          disabled={rssi?.status === 'loading'}
          onClick={onCheckRssi}
          style={{ alignSelf: 'flex-start' }}
        >
          {rssi?.status === 'loading' ? 'Checking…' : 'Check WiFi signal'}
        </Button>
      )}

      <section className="adm-drawer__section" aria-label="Temperature and humidity">
        <h3>{`Temperature and humidity, last ${TELEMETRY_HOURS} hours`}</h3>
        {(!telemetry || telemetry.status === 'loading') && (
          <p className="adm-sub" data-testid="monitors-telemetry-loading">Loading readings…</p>
        )}
        {telemetry?.status === 'error' && (
          <p className="adm-danger-text" role="alert" data-testid="monitors-telemetry-error">
            Couldn&rsquo;t load readings. Try again.
          </p>
        )}
        {telemetry?.status === 'loaded' && telemetry.points.length === 0 && (
          <p className="adm-sub" data-testid="monitors-telemetry-empty">
            No temperature or humidity readings yet. They&rsquo;ll appear here once this device
            reports in.
          </p>
        )}
        {telemetry?.status === 'loaded' && telemetry.points.length > 0 && (() => {
          const latest = telemetry.points[telemetry.points.length - 1]!;
          return (
            <div className="monitor-v2__telemetry" data-testid="monitors-telemetry">
              <p data-testid="monitors-telemetry-latest">
                {'Latest: '}
                <b>{latest.temp != null ? formatTempC(latest.temp, units) : '—'}</b>
                {' and '}
                <b>{latest.humidity != null ? `${Math.round(latest.humidity)}%` : '—'}</b>
                {` humidity, ${formatRelativeTime(latest.ts)}`}
              </p>
              <div>
                <span className="adm-sub">Temperature</span>
                <Sparkline values={telemetry.points.map((p) => p.temp)} testId="monitors-sparkline-temp" label="Temperature" />
              </div>
              <div>
                <span className="adm-sub">Humidity</span>
                <Sparkline values={telemetry.points.map((p) => p.humidity)} testId="monitors-sparkline-humidity" label="Humidity" />
              </div>
            </div>
          );
        })()}
      </section>
    </div>
  );
}
