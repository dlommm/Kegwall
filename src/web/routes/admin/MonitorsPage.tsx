import { Fragment, useCallback, useEffect, useState } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Monitor } from '../../../server/db/monitors.js';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import {
  listMonitors, bindMonitor, getMonitorTelemetry, resetKegtronVolume, getMonitorWifiRssi,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { formatVolumeMl, formatTempC } from '../../lib/units';
import { useAdminContext } from './useAdminContext';

/** How far back the Pro-device detail panel's temp/humidity sparkline looks — matches
 * `GET /api/monitors/:id/telemetry`'s own default window (Task 6). A time-range switcher
 * arrives with the rest of the charts in Task 9; this page only ever asks for 24h. */
const TELEMETRY_HOURS = 24;

const TYPE_LABELS: Record<Monitor['type'], string> = {
  kegtron_pro: 'Kegtron Pro',
  kegtron_gen1: 'Kegtron Gen 1',
};

type BindState = { monitor: Monitor; tapId: string; error: string | null };
type ResetState = { monitor: Monitor; result: 'idle' | 'done' | 'error'; error: string | null };
interface TelemetryEntry { status: 'loading' | 'loaded' | 'error'; points: TelemetryPoint[] }
interface RssiEntry { status: 'loading' | 'loaded' | 'error'; rssi: number | null; error: string | null }

function monitorLabel(monitor: Monitor): string {
  return monitor.identifier;
}

function tapLabel(tap: TapState): string {
  return tap.tapName ?? `Tap ${tap.tapNumber}`;
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
 * `/admin/monitors` (Task 6): discovered monitors table — type badge, identifier/serial,
 * port, last-seen, bound tap (or a visible "Not bound" nudge), and the tap's live volume
 * fed by the same `/ws` snapshot the taps page uses (matched via `monitor.tapId`). Editors
 * can bind/unbind a monitor to a tap and reset a Kegtron Pro device's on-board volume
 * counter; a Pro monitor's row also expands into a temp/humidity detail panel (viewer-
 * readable, same role as the rest of this page). A viewer sees everything read-only: no
 * bind/unbind/reset controls, but the detail expand still works (its own endpoint is
 * viewer role too).
 *
 * Phase 5 Task 0 spec-parity additions to that detail panel: firmware + online state
 * (read straight off `monitor.meta.fw`/`.online`, stamped at cloud discovery — see
 * shadow.ts's `diffToEvents` — so no extra request; a snapshot as of last discovery, not
 * continuously live) and a "Check WiFi signal" button (editor-gated, like reset —
 * `Kegtron.GetWiFiRssi` is a live device round-trip, not a cheap read) that reports the
 * current RSSI in dBm, 502-gently on failure.
 */
export function MonitorsPage() {
  const { me, units } = useAdminContext();
  const [initialTaps, setInitialTaps] = useState<TapState[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [expandedMonitorId, setExpandedMonitorId] = useState<number | null>(null);
  const [telemetryByMonitor, setTelemetryByMonitor] = useState<Record<number, TelemetryEntry>>({});
  const [bindState, setBindState] = useState<BindState | null>(null);
  const [binding, setBinding] = useState(false);
  const [unbindingId, setUnbindingId] = useState<number | null>(null);
  const [resetState, setResetState] = useState<ResetState | null>(null);
  const [resetting, setResetting] = useState(false);
  const [rssiByMonitor, setRssiByMonitor] = useState<Record<number, RssiEntry>>({});

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

  function loadTelemetry(monitorId: number) {
    setTelemetryByMonitor((prev) => ({ ...prev, [monitorId]: { status: 'loading', points: [] } }));
    getMonitorTelemetry(monitorId, TELEMETRY_HOURS).then((result) => {
      setTelemetryByMonitor((prev) => ({
        ...prev,
        [monitorId]: result.ok
          ? { status: 'loaded', points: result.data }
          : { status: 'error', points: [] },
      }));
    });
  }

  function toggleExpand(monitor: Monitor) {
    const next = expandedMonitorId === monitor.id ? null : monitor.id;
    setExpandedMonitorId(next);
    if (next != null && !telemetryByMonitor[next]) {
      loadTelemetry(next);
    }
  }

  /** WiFi RSSI is a live, on-demand device round-trip (unlike temp/humidity, which is
   * DB-backed telemetry history) — checked on click, not automatically on expand, so
   * opening a Pro monitor's details doesn't silently wake every device on the network. */
  function checkRssi(monitorId: number) {
    setRssiByMonitor((prev) => ({ ...prev, [monitorId]: { status: 'loading', rssi: null, error: null } }));
    getMonitorWifiRssi(monitorId).then((result) => {
      setRssiByMonitor((prev) => ({
        ...prev,
        [monitorId]: result.ok
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

  function openBindPicker(monitor: Monitor) {
    setBindState({ monitor, tapId: monitor.tapId != null ? String(monitor.tapId) : '', error: null });
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

  async function handleUnbind(monitor: Monitor) {
    setUnbindingId(monitor.id);
    const result = await bindMonitor(monitor.id, null);
    setUnbindingId(null);
    if (!result.ok) {
      // A one-click unbind still needs somewhere to say what happened — fall back to the
      // same picker used for the bind flow (prefilled to the tap it's still bound to)
      // rather than swallowing the failure silently.
      setBindState({
        monitor, tapId: monitor.tapId != null ? String(monitor.tapId) : '', error: result.message,
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
      {status === 'loaded' && monitors.length === 0 && (
        <p className="admin-page-quiet" data-testid="monitors-empty">
          No monitors discovered yet. They&rsquo;ll appear here once a Kegtron device reports in.
        </p>
      )}

      {status === 'loaded' && monitors.length > 0 && (
        <table className="admin-table monitors-table" data-testid="monitors-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Identifier</th>
              <th scope="col">Port</th>
              <th scope="col">Last seen</th>
              <th scope="col">Bound tap</th>
              <th scope="col">Volume</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {monitors.map((monitor) => {
              const isPro = monitor.type === 'kegtron_pro';
              const tap = taps.find((t) => t.tapId === monitor.tapId) ?? null;
              const hasLiveKeg = tap?.keg != null && tap.keg.status === 'on_tap';
              const expanded = expandedMonitorId === monitor.id;
              const telemetry = telemetryByMonitor[monitor.id];
              const rssi = rssiByMonitor[monitor.id];
              return (
                <Fragment key={monitor.id}>
                  <tr data-testid="monitors-row" data-monitor-type={monitor.type}>
                    <td>
                      <span
                        className={`monitors-type-badge monitors-type-badge--${monitor.type}`}
                        data-testid="monitors-row-type"
                      >
                        {TYPE_LABELS[monitor.type]}
                      </span>
                    </td>
                    <td>
                      <div data-testid="monitors-row-identifier">{monitor.identifier}</div>
                      {monitor.serial && (
                        <div className="monitors-row__quiet" data-testid="monitors-row-serial">
                          {monitor.serial}
                        </div>
                      )}
                    </td>
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
                      {isPro && (
                        <button
                          type="button"
                          data-testid="monitors-row-expand"
                          onClick={() => toggleExpand(monitor)}
                        >
                          {expanded ? 'Hide details' : 'Details'}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          data-testid="monitors-row-bind"
                          onClick={() => openBindPicker(monitor)}
                        >
                          {monitor.tapId != null ? 'Change tap' : 'Bind to tap'}
                        </button>
                      )}
                      {canEdit && monitor.tapId != null && (
                        <button
                          type="button"
                          data-testid="monitors-row-unbind"
                          disabled={unbindingId === monitor.id}
                          onClick={() => handleUnbind(monitor)}
                        >
                          {unbindingId === monitor.id ? 'Unbinding…' : 'Unbind'}
                        </button>
                      )}
                      {canEdit && isPro && (
                        <button
                          type="button"
                          data-testid="monitors-row-reset"
                          onClick={() => setResetState({ monitor, result: 'idle', error: null })}
                        >
                          Reset volume
                        </button>
                      )}
                    </td>
                  </tr>

                  {expanded && isPro && (
                    <tr data-testid="monitors-row-details">
                      <td colSpan={7}>
                        <div className="monitors-device-info" data-testid="monitors-device-info">
                          <span className="monitors-device-info__item" data-testid="monitors-device-firmware">
                            Firmware: {monitorFirmware(monitor) ?? 'Unknown'}
                          </span>
                          <span
                            className="monitors-device-info__item"
                            data-testid="monitors-device-online"
                            data-online={monitorOnlineFromMeta(monitor) ?? undefined}
                          >
                            {(() => {
                              const online = monitorOnlineFromMeta(monitor);
                              return online === null ? 'Online: Unknown' : online ? 'Online' : 'Offline';
                            })()}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              data-testid="monitors-rssi-check"
                              disabled={rssi?.status === 'loading'}
                              onClick={() => checkRssi(monitor.id)}
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

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
              Choose which tap {monitorLabel(bindState.monitor)} feeds, or leave it unbound.
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
              This will reset {monitorLabel(resetState.monitor)}&rsquo;s on-device dispensed-volume
              counter to zero, matching its configured keg size. Any pour tracking based on the old
              count is lost and this can&rsquo;t be undone.
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
