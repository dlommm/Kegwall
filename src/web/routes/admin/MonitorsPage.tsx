import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { TapState } from '../../../server/core/state.js';
import type { Monitor } from '../../../server/db/monitors.js';
import {
  listMonitors, bindMonitor, getMonitorTelemetry, resetKegtronVolume, getMonitorWifiRssi,
  updateMonitorIdentity,
} from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import { useTapStates } from '../../lib/useTapStates';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import { formatVolumeMl } from '../../lib/units';
import { groupMonitors, deviceLabel, type MonitorDeviceGroup } from '../../lib/monitorDevices';
import { capitalize, countWord } from '../../lib/tonightAttention';
import { beerColorFor } from '../../wall/wallModel';
import { useAdminContext } from './useAdminContext';
import { PageLeadFigure, PageTemplate } from './PageTemplate';
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Menu, MenuContent, MenuItem, MenuTrigger, Modal,
  SelectField, Skeleton, StatusDot, Table,
} from './ui';
import {
  DeviceDetails, TELEMETRY_HOURS, type RssiEntry, type TelemetryEntry,
} from './monitors/DeviceDetails';

/** A port heard from within this long counts as reporting. */
const REPORTING_MS = 15 * 60_000;
import {
  TYPE_LABELS, deviceLastSeen, goveeDeviceName, isReceiving, portLabel, tapLabel,
} from './monitors/monitorText';

type BindState = { monitor: Monitor; deviceName: string; tapId: string; error: string | null };
type ResetState = { monitor: Monitor; deviceName: string; result: 'idle' | 'done' | 'error'; error: string | null };
type RenameState = { group: MonitorDeviceGroup; value: string; saving: boolean; error: string | null };

/** "Four monitors on twelve ports. One hasn't reported in the last 10 minutes." */
export function monitorsHeadline(devices: MonitorDeviceGroup[], now: Date = new Date()): string {
  if (devices.length === 0) return 'No monitors yet.';
  const enabled = devices.filter((g) => g.ports[0]!.enabled);
  const ports = devices.filter((g) => g.type !== 'govee_sensor').reduce((n, g) => n + g.ports.length, 0);
  const count = devices.length === 1 ? 'One monitor' : `${capitalize(countWord(devices.length))} monitors`;
  const first = ports > 0 ? `${count} on ${countWord(ports)} port${ports === 1 ? '' : 's'}.` : `${count}.`;
  const quiet = enabled.filter((g) => !isReceiving(g, now));
  if (enabled.length === 0) return `${first} All are disabled.`;
  if (quiet.length === 0) return `${first} All of them are reporting.`;
  if (quiet.length === 1) return `${first} ${deviceLabel(quiet[0]!)} hasn’t reported in the last 10 minutes.`;
  return `${first} ${capitalize(countWord(quiet.length))} haven’t reported in the last 10 minutes.`;
}

/** Where a device's state comes from, said in the row (blueprint §E.8). */
function deviceState(group: MonitorDeviceGroup): { state: 'completed' | 'failed' | 'disabled'; label: string } {
  if (!group.ports[0]!.enabled) return { state: 'disabled', label: 'Disabled' };
  const seen = deviceLastSeen(group);
  if (!seen) return { state: 'failed', label: 'Never heard from' };
  return isReceiving(group)
    ? { state: 'completed', label: `Receiving · ${formatRelativeTime(seen)}` }
    : { state: 'failed', label: `Not heard from · ${formatRelativeTime(seen)}` };
}

/**
 * `/admin/monitors` (Kegwall V2 M8) — one section per physical device (`monitors` rows
 * grouped by type+identifier via `groupMonitors`; a Pro has 1-4 ports, a Gen 1 unit 1-2),
 * saying once what belongs to the device — its name (renamable), identifier/serial, whether
 * it's receiving and since when — with a port → tap table under it where each port binds to
 * a tap, shows what's left on that tap, and offers a per-port volume reset. Firmware, WiFi
 * and the temperature/humidity trend open in a drawer (telemetry is per DEVICE). A viewer
 * sees everything read-only; the details stay viewer-role like their endpoint.
 *
 * Any device can be disabled — the case is hardware living at another location. It stays
 * listed (dimmed) so it can be enabled again, but stops feeding the system entirely: no
 * volume updates, no pours, no telemetry (see core/state.ts).
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
  const devices = groupMonitors(monitors).sort((a, b) =>
    Number(b.ports[0]!.enabled) - Number(a.ports[0]!.enabled));
  const detailGroup = devices.find((g) => g.key === expandedDeviceKey) ?? null;

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
    <PageTemplate
      testId="admin-monitors-page"
      title={status === 'loaded' ? monitorsHeadline(devices) : 'Monitors'}
      lead={status === 'loaded' && devices.length > 0 && (() => {
        const ports = monitors.filter((m) => m.type !== 'govee_sensor' && m.enabled);
        const heard = ports.filter((m) => m.lastSeen && Date.now() - new Date(m.lastSeen).getTime() < REPORTING_MS).length;
        return ports.length > 0 && (
          <PageLeadFigure
            value={`${heard} of ${ports.length}`}
            label="ports reporting"
            tone={heard < ports.length ? 'warn' : undefined}
          />
        );
      })()}
      sub={(() => {
        const unbound = monitors.filter((m) => m.type !== 'govee_sensor' && m.enabled && m.tapId == null).length;
        if (status !== 'loaded' || devices.length === 0) return undefined;
        return unbound > 0
          ? `${capitalize(countWord(unbound))} port${unbound === 1 ? ' isn’t' : 's aren’t'} bound to a tap yet, so ${unbound === 1 ? 'its pours go' : 'their pours go'} nowhere.`
          : 'Each port feeds one tap. Pours and levels come from the port it’s bound to.';
      })()}
      drawer={(
        <>
          {detailGroup && (
            <Drawer
              open
              onOpenChange={(open) => { if (!open) setExpandedDeviceKey(null); }}
              title={deviceLabel(detailGroup)}
              description={`${TYPE_LABELS[detailGroup.type]} · ${detailGroup.identifier}`}
            >
              <DeviceDetails
                group={detailGroup}
                units={units}
                canEdit={canEdit}
                telemetry={telemetryByDevice[detailGroup.key]}
                rssi={rssiByDevice[detailGroup.key]}
                onCheckRssi={() => checkRssi(detailGroup)}
              />
            </Drawer>
          )}

          <Modal
            open={bindState !== null}
            onOpenChange={(open) => { if (!open && !binding) setBindState(null); }}
            title="Bind to a tap"
            description={bindState ? `Choose which tap ${portLabel(bindState.deviceName, bindState.monitor)} feeds, or leave it unbound.` : undefined}
            testId="monitors-bind-picker"
            footer={(
              <>
                <Button variant="primary" data-testid="monitors-bind-submit" disabled={binding} onClick={handleBindSubmit}>
                  {binding ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="quiet" data-testid="monitors-bind-cancel" disabled={binding} onClick={() => setBindState(null)}>
                  Cancel
                </Button>
              </>
            )}
          >
            {bindState && (
              <>
                <SelectField
                  label="Tap"
                  data-testid="monitors-bind-select"
                  value={bindState.tapId}
                  onChange={(e) => setBindState({ ...bindState, tapId: e.target.value })}
                >
                  <option value="">Not bound</option>
                  {taps.map((t) => (
                    <option key={t.tapId} value={t.tapId}>{tapLabel(t)}</option>
                  ))}
                </SelectField>
                {bindState.error && (
                  <p className="adm-modal__error" role="alert" data-testid="monitors-bind-error">{bindState.error}</p>
                )}
              </>
            )}
          </Modal>

          <ConfirmDialog
            open={resetState !== null}
            onOpenChange={(open) => { if (!open) setResetState(null); }}
            title="Reset the volume counter?"
            confirmLabel={resetState?.result === 'done' ? 'Done' : 'Reset volume'}
            busyLabel="Resetting…"
            busy={resetting}
            error={resetState?.result === 'error' ? resetState.error : null}
            onConfirm={() => (resetState?.result === 'done' ? setResetState(null) : handleConfirmReset())}
            testId="monitors-reset-confirm"
            confirmTestId={resetState?.result === 'done' ? 'monitors-reset-close' : 'monitors-reset-confirm-button'}
            cancelTestId="monitors-reset-cancel-button"
            errorTestId="monitors-reset-error"
          >
            {resetState && (
              <>
                <p>
                  This will reset {portLabel(resetState.deviceName, resetState.monitor)}&rsquo;s on-device
                  dispensed-volume counter to zero, matching its configured keg size. Any pour tracking
                  based on the old count is lost and this can&rsquo;t be undone.
                </p>
                {resetState.result === 'done' && (
                  <p className="adm-ok-text" data-testid="monitors-reset-done">Volume reset on the device.</p>
                )}
              </>
            )}
          </ConfirmDialog>
        </>
      )}
    >
      {status === 'loading' && <div data-testid="monitors-loading"><Skeleton height={120} /></div>}
      {status === 'error' && (
        <div data-testid="monitors-error">
          <ErrorState title="Couldn’t load monitors." onRetry={loadMonitors}>Reload to try again.</ErrorState>
        </div>
      )}
      {status === 'loaded' && devices.length === 0 && (
        <div data-testid="monitors-empty">
          <EmptyState title="No monitors discovered yet.">
            They&rsquo;ll appear here once a Kegtron device reports in.
          </EmptyState>
        </div>
      )}

      {status === 'loaded' && devices.map((group) => {
        const isPro = group.type === 'kegtron_pro';
        const isGovee = group.type === 'govee_sensor';
        const anchor = group.ports[0]!;
        const isDisabled = !anchor.enabled;
        const renaming = renameState?.group.key === group.key ? renameState : null;
        const state = deviceState(group);
        return (
          <article
            className={isDisabled ? 'monitor-v2 is-disabled' : 'monitor-v2'}
            data-testid="monitors-device-card"
            data-device-type={group.type}
            key={group.key}
          >
            <header className="monitor-v2__head">
              <div className="monitor-v2__who">
                {renaming ? (
                  <span className="monitor-v2__rename">
                    <input
                      type="text"
                      className="adm-input"
                      aria-label="Device name"
                      data-testid="monitors-card-rename-input"
                      value={renaming.value}
                      disabled={renaming.saving}
                      placeholder={group.identifier}
                      onChange={(e) => setRenameState({ ...renaming, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameSubmit(); }}
                    />
                    <Button variant="primary" data-testid="monitors-card-rename-save" disabled={renaming.saving} onClick={handleRenameSubmit}>
                      {renaming.saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button variant="quiet" data-testid="monitors-card-rename-cancel" disabled={renaming.saving} onClick={() => setRenameState(null)}>
                      Cancel
                    </Button>
                    {renaming.error && (
                      <span className="adm-danger-text" role="alert" data-testid="monitors-card-rename-error">{renaming.error}</span>
                    )}
                  </span>
                ) : (
                  <h2 className="adm-name" data-testid="monitors-card-name">{deviceLabel(group)}</h2>
                )}
                <p className="adm-sub monitor-v2__meta">
                  <span data-testid="monitors-card-type">{TYPE_LABELS[group.type]}</span>
                  {' · '}
                  <span data-testid="monitors-card-identifier">{group.identifier}</span>
                  {isGovee && goveeDeviceName(anchor) && (
                    <>{' · '}<span data-testid="monitors-card-govee-name">{goveeDeviceName(anchor)}</span></>
                  )}
                  {group.serial && <>{' · '}<span data-testid="monitors-card-serial">{group.serial}</span></>}
                </p>
              </div>
              <span className="monitor-v2__state">
                {isDisabled
                  ? <span data-testid="monitors-card-disabled-badge"><StatusDot state={state.state} label={state.label} /></span>
                  : <StatusDot state={state.state} label={state.label} />}
                <span className="adm-sr-only" data-testid="monitors-card-lastseen">
                  {deviceLastSeen(group) ? formatRelativeTime(deviceLastSeen(group)!) : 'Never seen'}
                </span>
              </span>
              <span className="monitor-v2__actions">
                {(isPro || isGovee) && (
                  <Button variant="quiet" data-testid="monitors-card-expand" onClick={() => toggleExpand(group)}>
                    Details
                  </Button>
                )}
                {canEdit && !renaming && (
                  <Button
                    variant="quiet"
                    data-testid="monitors-card-rename"
                    onClick={() => setRenameState({ group, value: group.name ?? '', saving: false, error: null })}
                  >
                    Rename
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="quiet"
                    data-testid="monitors-card-toggle-enabled"
                    onClick={() => {
                      void updateMonitorIdentity(group.anchorId, { enabled: isDisabled }).then(loadMonitors);
                    }}
                  >
                    {isDisabled ? 'Enable' : 'Disable'}
                  </Button>
                )}
              </span>
            </header>

            {!isGovee && (
              <Table className="monitor-v2__ports" data-testid="monitors-port-table">
                <thead>
                  <tr>
                    <th scope="col">Port</th>
                    <th scope="col">Feeds tap</th>
                    <th scope="col" className="adm-num">Left on tap</th>
                    <th scope="col">Last seen</th>
                    <th scope="col"><span className="adm-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {group.ports.map((monitor) => {
                    const tap = taps.find((t) => t.tapId === monitor.tapId) ?? null;
                    const hasLiveKeg = tap?.keg != null && tap.keg.status === 'on_tap';
                    return (
                      <tr
                        data-testid="monitors-port-row"
                        key={monitor.id}
                        className={tap?.beer && hasLiveKeg ? 'monitor-v2__port-row' : undefined}
                        style={tap?.beer && hasLiveKeg ? { '--srm': beerColorFor(tap.beer.srm) } as CSSProperties : undefined}
                      >
                        <td className="adm-num-cell monitor-v2__port" data-testid="monitors-row-port">{monitor.portIndex}</td>
                        <td>
                          {tap ? (
                            <span data-testid="monitors-row-tap">
                              <b>{tapLabel(tap)}</b>
                              {tap.beer && <span className="adm-sub">{` · ${tap.beer.name}`}</span>}
                            </span>
                          ) : (
                            <span className="adm-warn-text" data-testid="monitors-row-unbound-nudge">Not bound</span>
                          )}
                        </td>
                        <td className="adm-num" data-testid="monitors-row-volume">
                          {hasLiveKeg && tap?.keg ? formatVolumeMl(tap.keg.remainingMl, units) : '—'}
                        </td>
                        <td className="adm-num-cell adm-sub" data-testid="monitors-row-lastseen">
                          {monitor.lastSeen ? formatRelativeTime(monitor.lastSeen) : 'Never'}
                        </td>
                        <td className="adm-actions">
                          {canEdit && (
                            <Button
                              variant={monitor.tapId == null ? 'primary' : 'quiet'}
                              data-testid="monitors-row-bind"
                              onClick={() => openBindPicker(monitor, deviceLabel(group))}
                            >
                              {monitor.tapId != null ? 'Change tap' : 'Bind a tap'}
                            </Button>
                          )}
                          {canEdit && (monitor.tapId != null || isPro) && (
                            // The routine action stays in view; the rarer ones live in a menu.
                            <Menu>
                              <MenuTrigger
                                className="adm-btn adm-btn--quiet monitor-v2__more"
                                data-testid="monitors-row-more"
                                aria-label={`More for port ${monitor.portIndex}`}
                              >
                                ⋯
                              </MenuTrigger>
                              <MenuContent>
                                {monitor.tapId != null && (
                                  <MenuItem
                                    data-testid="monitors-row-unbind"
                                    disabled={unbindingId === monitor.id}
                                    onSelect={() => handleUnbind(monitor, deviceLabel(group))}
                                  >
                                    {unbindingId === monitor.id ? 'Unbinding…' : 'Unbind this port'}
                                  </MenuItem>
                                )}
                                {isPro && (
                                  <MenuItem
                                    data-testid="monitors-row-reset"
                                    onSelect={() => setResetState({
                                      monitor, deviceName: deviceLabel(group), result: 'idle', error: null,
                                    })}
                                  >
                                    Reset volume
                                  </MenuItem>
                                )}
                              </MenuContent>
                            </Menu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </article>
        );
      })}
    </PageTemplate>
  );
}
