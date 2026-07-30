import { useCallback, useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Monitor } from '../../../server/db/monitors.js';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import {
  listMonitors, bindMonitor, getMonitorTelemetry, resetKegtronVolume, getMonitorWifiRssi,
  updateMonitorIdentity,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { formatVolumeMl, formatTempC } from '../../lib/units';
import { groupMonitors, deviceLabel, type MonitorDeviceGroup } from '../../lib/monitorDevices';
import { useAdminContext } from './useAdminContext';

/** How far back the Pro-device detail panel's temp/humidity sparkline looks — matches
 * `GET /api/monitors/:id/telemetry`'s own default window (Task 6). A time-range switcher
 * arrives with the rest of the charts in Task 9; this page only ever asks for 24h. */
const TELEMETRY_HOURS = 24;

const TYPE_LABELS: Record<Monitor['type'], string> = {
  kegtron_pro: 'Kegtron Pro',
  kegtron_gen1: 'Kegtron Gen 1',
  govee_sensor: 'Govee sensor',
};

/** `meta.deviceName` — the sensor's name in Govee's own app, stamped at discovery.
 * Read defensively like `monitorFirmware` (meta is untyped JSON). */
function goveeDeviceName(monitor: Monitor): string | null {
  const name = monitor.meta.deviceName;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

type BindState = { monitor: Monitor; deviceName: string; tapId: string; error: string | null };
type ResetState = { monitor: Monitor; deviceName: string; result: 'idle' | 'done' | 'error'; error: string | null };
type RenameState = { group: MonitorDeviceGroup; value: string; saving: boolean; error: string | null };
interface TelemetryEntry { status: 'loading' | 'loaded' | 'error'; points: TelemetryPoint[] }
interface RssiEntry { status: 'loading' | 'loaded' | 'error'; rssi: number | null; error: string | null }

function tapLabel(tap: TapState): string {
  return tap.tapName ?? `Tap ${tap.tapNumber}`;
}

/** Dialog copy for a single port of a device — "Main kegerator, port 2". */
function portLabel(deviceName: string, monitor: Monitor): string {
  return `${deviceName}, port ${monitor.portIndex}`;
}

/** `monitor.meta.fw`/`.online` — stamped at cloud discovery (see shadow.ts's
 * `diffToEvents`, Phase 5 Task 0). `meta` is a plain `Record<string, unknown>` (it's
 * JSON under the hood — `db/monitors.ts` never narrows its shape), so these read it
 * defensively rather than trusting the field is present/well-typed (an older monitor row,
 * discovered before this field existed, or a Gen 1 monitor, simply has neither key). */
function monitorFirmware(monitor: Monitor): string | null {
  const fw = monitor.meta.fw;
  return typeof fw === 'string' && fw.length > 0 ? fw : null;
}

function monitorOnlineFromMeta(monitor: Monitor): boolean | null {
  const online = monitor.meta.online;
  return typeof online === 'boolean' ? online : null;
}

/** The freshest last-seen across a device's ports (each port row updates its own). */
function deviceLastSeen(group: MonitorDeviceGroup): string | null {
  const seen = group.ports.map((p) => p.lastSeen).filter((s): s is string => s != null);
  return seen.length > 0 ? seen.sort().at(-1)! : null;
}

/** A tiny inline `<svg><polyline>` sparkline — no chart lib yet (Recharts arrives Task
 * 9). Renders nothing but a quiet "not enough data" note until there are at least two
 * numeric samples to draw a line between. Null samples (a sensor with no humidity, or a
 * gap in reporting) are simply skipped rather than plotted as zero. */
function Sparkline({ values, testId, label }: { values: (number | null)[]; testId: string; label: string }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) {
    return (
      <p className="monitors-sparkline-empty" data-testid={`${testId}-empty`}>
        Not enough readings yet for a trend line.
      </p>
    );
  }
  const width = 120;
  const height = 28;
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
      className="monitors-sparkline"
      data-testid={testId}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label} over the last ${TELEMETRY_HOURS} hours`}
    >
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * `/admin/monitors` — one CARD per physical Kegtron device (`monitors` rows grouped by
 * type+identifier via `groupMonitors`; a Pro has 1-4 ports, a Gen 1 unit 1-2), with the
 * device-level things said once — editable friendly name, identifier/serial, freshest
 * last-seen, firmware + online (from cloud-discovery meta), a "Check WiFi signal"
 * round-trip and ONE temp/humidity detail panel (telemetry is per DEVICE: Kegtron
 * reports temp once per device, and `GET /api/monitors/:id/telemetry` answers
 * device-wide for any port row) — and a port table underneath where each port binds to
 * a tap, shows its live volume, and offers per-port Reset volume. A viewer sees
 * everything read-only (no rename/bind/unbind/reset/WiFi controls); the detail expand
 * stays viewer-role like its endpoint.
 */
export function MonitorsPage() {
  const { me, units } = useAdminContext();
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [expandedDeviceKey, setExpandedDeviceKey] = useState<string | null>(null);
  const [telemetryByDevice, setTelemetryByDevice] = useState<Record<string, TelemetryEntry>>({});
  const [bindState, setBindState] = useState<BindState | null>(null);
  const [binding, setBinding] = useState(false);
  const [unbindingId, setUnbindingId] = useState<number | null>(null);
  const [resetState, setResetState] = useState<ResetState | null>(null);
  const [resetting, setResetting] = useState(false);
  const [rssiByDevice, setRssiByDevice] = useState<Record<string, RssiEntry>>({});
  const [renameState, setRenameState] = useState<RenameState | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (cancelled || !result.ok) return;
      setInitialTaps(result.data.taps);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { taps } = useTapStates(initialTaps);

  const loadMonitors = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    listMonitors().then((result) => {
      if (result.ok) {
        setMonitors(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    loadMonitors();
  }, [loadMonitors]);

  const canEdit = me.role === 'editor' || me.role === 'admin';
  const devices = groupMonitors(monitors);

  function loadTelemetry(group: MonitorDeviceGroup) {
    setTelemetryByDevice((prev) => ({ ...prev, [group.key]: { status: 'loading', points: [] } }));
    getMonitorTelemetry(group.anchorId, TELEMETRY_HOURS).then((result) => {
      setTelemetryByDevice((prev) => ({
        ...prev,
        [group.key]: result.ok
          ? { status: 'loaded', points: result.data }
          : { status: 'error', points: [] },
      }));
    });
  }

  function toggleExpand(group: MonitorDeviceGroup) {
    const next = expandedDeviceKey === group.key ? null : group.key;
    setExpandedDeviceKey(next);
    if (next != null && !telemetryByDevice[next]) {
      loadTelemetry(group);
    }
  }

  /** WiFi RSSI is a live, on-demand device round-trip (unlike temp/humidity, which is
   * DB-backed telemetry history) — checked on click, not automatically on expand, so
   * opening a Pro device's details doesn't silently wake every device on the network.
   * One check per DEVICE: `Kegtron.GetWiFiRssi` takes no port argument. */
  function checkRssi(group: MonitorDeviceGroup) {
    setRssiByDevice((prev) => ({ ...prev, [group.key]: { status: 'loading', rssi: null, error: null } }));
    getMonitorWifiRssi(group.anchorId).then((result) => {
      setRssiByDevice((prev) => ({
        ...prev,
        [group.key]: result.ok
          ? { status: 'loaded', rssi: result.data.rssi, error: null }
          : {
              status: 'error',
              rssi: null,
              error: result.status === 502
                ? "Couldn't reach the Kegtron device. You can try again."
                : result.message,
            },
      }));
    });
  }

  async function handleRenameSubmit() {
    if (!renameState) return;
    setRenameState({ ...renameState, saving: true, error: null });
    const name = renameState.value.trim();
    const result = await updateMonitorIdentity(renameState.group.anchorId, { name: name === '' ? null : name });
    if (!result.ok) {
      setRenameState({ ...renameState, saving: false, error: result.message });
      return;
    }
    setRenameState(null);
    loadMonitors();
  }

  function openBindPicker(monitor: Monitor, deviceName: string) {
    setBindState({ monitor, deviceName, tapId: monitor.tapId != null ? String(monitor.tapId) : '', error: null });
  }

  async function handleBindSubmit() {
    if (!bindState) return;
    setBinding(true);
    const tapId = bindState.tapId === '' ? null : Number(bindState.tapId);
    const result = await bindMonitor(bindState.monitor.id, tapId);
    setBinding(false);
    if (!result.ok) {
      setBindState({ ...bindState, error: result.message });
      return;
    }
    setBindState(null);
    loadMonitors();
  }

  async function handleUnbind(monitor: Monitor, deviceName: string) {
    setUnbindingId(monitor.id);
    const result = await bindMonitor(monitor.id, null);
    setUnbindingId(null);
    if (!result.ok) {
      // A one-click unbind still needs somewhere to say what happened — fall back to the
      // same picker used for the bind flow (prefilled to the tap it's still bound to)
      // rather than swallowing the failure silently.
      setBindState({
        monitor, deviceName, tapId: monitor.tapId != null ? String(monitor.tapId) : '', error: result.message,
      });
      return;
    }
    loadMonitors();
  }

  async function handleConfirmReset() {
    if (!resetState) return;
    setResetting(true);
    const result = await resetKegtronVolume(resetState.monitor.id);
    setResetting(false);
    if (result.ok) {
      setResetState({ ...resetState, result: 'done', error: null });
      return;
    }
    setResetState({
      ...resetState,
      result: 'error',
      error: result.status === 502
        ? "Couldn't reach the Kegtron device. You can try again."
        : result.message,
    });
  }

  return (
    <section data-testid="admin-monitors-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Monitors</h1>
      </header>

      {status === 'loading' && <p className="admin-page-quiet" data-testid="monitors-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="monitors-error">
          Couldn&rsquo;t load monitors. Reload to try again.
        </p>
      )}
      {status === 'loaded' && devices.length === 0 && (
        <p className="admin-page-quiet" data-testid="monitors-empty">
          No monitors discovered yet. They&rsquo;ll appear here once a Kegtron device reports in.
        </p>
      )}

      {status === 'loaded' && devices.map((group) => {
        const isPro = group.type === 'kegtron_pro';
        const isGovee = group.type === 'govee_sensor';
        const anchor = group.ports[0]!;
        const isDisabled = !anchor.enabled;
        const expanded = expandedDeviceKey === group.key;
        const telemetry = telemetryByDevice[group.key];
        const rssi = rssiByDevice[group.key];
        const renaming = renameState?.group.key === group.key ? renameState : null;
        const lastSeen = deviceLastSeen(group);
        return (
          <article
            className={`monitors-device-card${isDisabled ? ' monitors-device-card--disabled' : ''}`}
            data-testid="monitors-device-card"
            data-device-type={group.type}
            key={group.key}
          >
            <header className="monitors-device-card__header">
              <span
                className={`monitors-type-badge monitors-type-badge--${group.type}`}
                data-testid="monitors-card-type"
              >
                {TYPE_LABELS[group.type]}
              </span>
              {renaming ? (
                <span className="monitors-device-card__rename">
                  <input
                    type="text"
                    data-testid="monitors-card-rename-input"
                    value={renaming.value}
                    disabled={renaming.saving}
                    placeholder={group.identifier}
                    onChange={(e) => setRenameState({ ...renaming, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameSubmit(); }}
                  />
                  <button
                    type="button"
                    data-testid="monitors-card-rename-save"
                    disabled={renaming.saving}
                    onClick={handleRenameSubmit}
                  >
                    {renaming.saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    data-testid="monitors-card-rename-cancel"
                    disabled={renaming.saving}
                    onClick={() => setRenameState(null)}
                  >
                    Cancel
                  </button>
                  {renaming.error && (
                    <span role="alert" data-testid="monitors-card-rename-error">{renaming.error}</span>
                  )}
                </span>
              ) : (
                <>
                  <h2 className="monitors-device-card__name font-display" data-testid="monitors-card-name">
                    {deviceLabel(group)}
                  </h2>
                  {canEdit && (
                    <button
                      type="button"
                      data-testid="monitors-card-rename"
                      onClick={() => setRenameState({ group, value: group.name ?? '', saving: false, error: null })}
                    >
                      Rename
                    </button>
                  )}
                </>
              )}
              <span className="monitors-device-card__meta">
                <span data-testid="monitors-card-identifier">{group.identifier}</span>
                {isGovee && goveeDeviceName(anchor) && (
                  <span className="monitors-row__quiet" data-testid="monitors-card-govee-name">
                    {goveeDeviceName(anchor)}
                  </span>
                )}
                {group.serial && (
                  <span className="monitors-row__quiet" data-testid="monitors-card-serial">{group.serial}</span>
                )}
                <span className="font-tabular" data-testid="monitors-card-lastseen">
                  {lastSeen ? formatRelativeTime(lastSeen) : 'Never seen'}
                </span>
              </span>
              {isDisabled && (
                <span className="look-badge look-badge--kicked" data-testid="monitors-card-disabled-badge">
                  DISABLED
                </span>
              )}
              {canEdit && isGovee && (
                <button
                  type="button"
                  data-testid="monitors-card-toggle-enabled"
                  onClick={() => {
                    void updateMonitorIdentity(group.anchorId, { enabled: isDisabled }).then(loadMonitors);
                  }}
                >
                  {isDisabled ? 'Enable' : 'Disable'}
                </button>
              )}
              {(isPro || isGovee) && (
                <button
                  type="button"
                  data-testid="monitors-card-expand"
                  onClick={() => toggleExpand(group)}
                >
                  {expanded ? 'Hide details' : 'Details'}
                </button>
              )}
            </header>

            {expanded && (isPro || isGovee) && (
              <div data-testid="monitors-card-details">
                {isPro && (
                <div className="monitors-device-info" data-testid="monitors-device-info">
                  <span className="monitors-device-info__item" data-testid="monitors-device-firmware">
                    Firmware: {monitorFirmware(anchor) ?? 'Unknown'}
                  </span>
                  <span
                    className="monitors-device-info__item"
                    data-testid="monitors-device-online"
                    data-online={monitorOnlineFromMeta(anchor) ?? undefined}
                  >
                    {(() => {
                      const online = monitorOnlineFromMeta(anchor);
                      return online === null ? 'Online: Unknown' : online ? 'Online' : 'Offline';
                    })()}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      data-testid="monitors-rssi-check"
                      disabled={rssi?.status === 'loading'}
                      onClick={() => checkRssi(group)}
                    >
                      {rssi?.status === 'loading' ? 'Checking…' : 'Check WiFi signal'}
                    </button>
                  )}
                  {rssi?.status === 'loaded' && (
                    <span data-testid="monitors-rssi-value">{rssi.rssi} dBm</span>
                  )}
                  {rssi?.status === 'error' && (
                    <span role="alert" data-testid="monitors-rssi-error">{rssi.error}</span>
                  )}
                </div>
                )}
                {(!telemetry || telemetry.status === 'loading') && (
                  <p data-testid="monitors-telemetry-loading">Loading readings…</p>
                )}
                {telemetry?.status === 'error' && (
                  <p role="alert" data-testid="monitors-telemetry-error">
                    Couldn&rsquo;t load readings. Try again.
                  </p>
                )}
                {telemetry?.status === 'loaded' && telemetry.points.length === 0 && (
                  <p data-testid="monitors-telemetry-empty">
                    No temperature or humidity readings yet — they&rsquo;ll appear here once this
                    device reports in.
                  </p>
                )}
                {telemetry?.status === 'loaded' && telemetry.points.length > 0 && (() => {
                  const latest = telemetry.points[telemetry.points.length - 1]!;
                  return (
                    <div className="monitors-telemetry" data-testid="monitors-telemetry">
                      <p className="monitors-telemetry__latest" data-testid="monitors-telemetry-latest">
                        Latest: {latest.temp != null ? formatTempC(latest.temp, units) : '—'}
                        {' / '}
                        {latest.humidity != null ? `${Math.round(latest.humidity)}%` : '—'} humidity
                        {' — '}
                        {formatRelativeTime(latest.ts)}
                      </p>
                      <div className="monitors-telemetry__sparklines">
                        <div className="monitors-telemetry__sparkline-block">
                          <span className="monitors-telemetry__sparkline-label">
                            Temp ({TELEMETRY_HOURS}h)
                          </span>
                          <Sparkline
                            values={telemetry.points.map((p) => p.temp)}
                            testId="monitors-sparkline-temp"
                            label="Temperature"
                          />
                        </div>
                        <div className="monitors-telemetry__sparkline-block">
                          <span className="monitors-telemetry__sparkline-label">
                            Humidity ({TELEMETRY_HOURS}h)
                          </span>
                          <Sparkline
                            values={telemetry.points.map((p) => p.humidity)}
                            testId="monitors-sparkline-humidity"
                            label="Humidity"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {!isGovee && (
            <table className="admin-table monitors-table" data-testid="monitors-port-table">
              <thead>
                <tr>
                  <th scope="col">Port</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Bound tap</th>
                  <th scope="col">Volume</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {group.ports.map((monitor) => {
                  const tap = taps.find((t) => t.tapId === monitor.tapId) ?? null;
                  const hasLiveKeg = tap?.keg != null && tap.keg.status === 'on_tap';
                  return (
                    <tr data-testid="monitors-port-row" key={monitor.id}>
                      <td className="font-tabular" data-testid="monitors-row-port">{monitor.portIndex}</td>
                      <td className="font-tabular" data-testid="monitors-row-lastseen">
                        {monitor.lastSeen ? formatRelativeTime(monitor.lastSeen) : 'Never'}
                      </td>
                      <td>
                        {tap ? (
                          <span data-testid="monitors-row-tap">{tapLabel(tap)}</span>
                        ) : (
                          <span className="monitors-row__unbound" data-testid="monitors-row-unbound-nudge">
                            Not bound
                          </span>
                        )}
                      </td>
                      <td className="font-tabular" data-testid="monitors-row-volume">
                        {hasLiveKeg && tap?.keg ? formatVolumeMl(tap.keg.remainingMl, units) : '—'}
                      </td>
                      <td className="monitors-row__actions">
                        {canEdit && (
                          <button
                            type="button"
                            data-testid="monitors-row-bind"
                            onClick={() => openBindPicker(monitor, deviceLabel(group))}
                          >
                            {monitor.tapId != null ? 'Change tap' : 'Bind to tap'}
                          </button>
                        )}
                        {canEdit && monitor.tapId != null && (
                          <button
                            type="button"
                            data-testid="monitors-row-unbind"
                            disabled={unbindingId === monitor.id}
                            onClick={() => handleUnbind(monitor, deviceLabel(group))}
                          >
                            {unbindingId === monitor.id ? 'Unbinding…' : 'Unbind'}
                          </button>
                        )}
                        {canEdit && isPro && (
                          <button
                            type="button"
                            data-testid="monitors-row-reset"
                            onClick={() => setResetState({
                              monitor, deviceName: deviceLabel(group), result: 'idle', error: null,
                            })}
                          >
                            Reset volume
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </article>
        );
      })}

      {bindState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="monitors-bind-picker"
          onClick={() => !binding && setBindState(null)}
        >
          <div
            className="admin-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="monitors-bind-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="monitors-bind-title" className="font-display">Bind to a tap</h3>
            <p>
              Choose which tap {portLabel(bindState.deviceName, bindState.monitor)} feeds, or leave it unbound.
            </p>
            <label className="admin-field">
              <span>Tap</span>
              <select
                data-testid="monitors-bind-select"
                value={bindState.tapId}
                onChange={(e) => setBindState({ ...bindState, tapId: e.target.value })}
              >
                <option value="">Not bound</option>
                {taps.map((t) => (
                  <option key={t.tapId} value={t.tapId}>{tapLabel(t)}</option>
                ))}
              </select>
            </label>
            {bindState.error && (
              <p role="alert" data-testid="monitors-bind-error">{bindState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="monitors-bind-submit"
                disabled={binding}
                onClick={handleBindSubmit}
              >
                {binding ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                data-testid="monitors-bind-cancel"
                disabled={binding}
                onClick={() => setBindState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {resetState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="monitors-reset-confirm"
          onClick={() => !resetting && setResetState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="monitors-reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="monitors-reset-title" className="font-display">Reset volume</h3>
            <p>
              This will reset {portLabel(resetState.deviceName, resetState.monitor)}&rsquo;s on-device
              dispensed-volume counter to zero, matching its configured keg size. Any pour tracking
              based on the old count is lost and this can&rsquo;t be undone.
            </p>
            {resetState.result === 'done' && (
              <p data-testid="monitors-reset-done">Volume reset on the device.</p>
            )}
            {resetState.result === 'error' && (
              <p role="alert" data-testid="monitors-reset-error">{resetState.error}</p>
            )}
            <div className="admin-confirm__actions">
              {resetState.result !== 'done' && (
                <button
                  type="button"
                  data-testid="monitors-reset-confirm-button"
                  disabled={resetting}
                  onClick={handleConfirmReset}
                >
                  {resetting ? 'Resetting…' : 'Reset volume'}
                </button>
              )}
              <button
                type="button"
                data-testid="monitors-reset-cancel-button"
                disabled={resetting}
                onClick={() => setResetState(null)}
              >
                {resetState.result === 'done' ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
