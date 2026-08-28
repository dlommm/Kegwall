// --- Task 6: monitors page (+ Kegtron RPC bridges, sensors, monitor identity) ---
import type { Beer } from '../../../server/db/beers.js';
import type { Monitor } from '../../../server/db/monitors.js';
import type { TelemetryPoint } from '../../../server/db/telemetry.js';
import { request, type ApiResult } from '../adminHttp';

export type { SensorSummary } from '../../../server/db/sensors.js';

/** A monitor plus `deviceKeg` — the size/starting volume the Kegtron device itself
 * reports (whatever the operator set in Kegtron's own app), used by the swap wizard's
 * prefill. Null until the server has heard a volume update since boot. */
export type MonitorWithDeviceKeg = Monitor & {
  deviceKeg: import('../../../server/core/state.js').DeviceKegInfo | null;
};

/** GET /api/monitors — sanitized (no device key) monitor list; the swap wizard uses this
 * to find a Kegtron Pro monitor bound to the tap being swapped (unlocks the "Import from
 * Kegtron" beer-pick option, the size-step device prefill, and the step 4 "Reset volume
 * on device" action). */
export function listMonitors(): Promise<ApiResult<MonitorWithDeviceKeg[]>> {
  return request('/api/monitors');
}

/** GET /api/sensors — one summary per physical temperature sensor (Kegtron probe + Govee)
 * with its current reading + trailing-7-day range; feeds the dashboard's per-sensor cards. */
export function getSensors(): Promise<ApiResult<import('../../../server/db/sensors.js').SensorSummary[]>> {
  return request('/api/sensors');
}

/** POST /api/kegtron/import/:monitorId — creates a beer from a bound Pro monitor's
 * current device config (Kegtron import, swap wizard step 2). */
export function importKegtronBeer(monitorId: number): Promise<ApiResult<Beer>> {
  return request(`/api/kegtron/import/${monitorId}`, { method: 'POST' });
}

/** POST /api/kegtron/reset-volume/:monitorId — zeroes the physical device's dispensed-
 * volume counter for a bound Pro monitor's port (swap wizard step 4, optional; also the
 * Monitors page's standalone reset action, Task 6). */
export function resetKegtronVolume(monitorId: number): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/kegtron/reset-volume/${monitorId}`, { method: 'POST', body: JSON.stringify({}) });
}

/** POST /api/monitors/:id/bind — binds (a numeric `tapId`) or unbinds (`null`) a
 * discovered monitor; the response is the sanitized `Monitor` (no device key). */
export function bindMonitor(id: number, tapId: number | null): Promise<ApiResult<Monitor>> {
  return request(`/api/monitors/${id}/bind`, { method: 'POST', body: JSON.stringify({ tapId }) });
}

/** GET /api/monitors/:id/telemetry?hours= — a Kegtron Pro monitor's recent temp/humidity
 * readings (viewer role), feeding the Monitors page's per-device detail expand. `hours`
 * defaults to 24 server-side when omitted. */
export function getMonitorTelemetry(id: number, hours = 24): Promise<ApiResult<TelemetryPoint[]>> {
  return request(`/api/monitors/${id}/telemetry?hours=${hours}`);
}

/** POST /api/kegtron/wifi-rssi/:monitorId — a live Kegtron.GetWiFiRssi RPC round-trip
 * (editor role, matching every other kegtron.ts RPC bridge) for a bound Pro monitor's
 * WiFi signal strength in dBm; the Monitors page's Pro detail panel button (Phase 5 Task
 * 0). A 502 (device unreachable / mdash error) is the expected "gentle" failure mode —
 * same shape as `resetKegtronVolume` above. */
export function getMonitorWifiRssi(monitorId: number): Promise<ApiResult<{ rssi: number }>> {
  return request(`/api/kegtron/wifi-rssi/${monitorId}`, { method: 'POST' });
}

// --- Pour Wall overhaul Phase 5: monitor identity ---------------------------

/** PATCH /api/monitors/:id/identity — device-level identity: every port row sharing
 * the addressed monitor's type+identifier gets the name/enabled state. Disabling a
 * Govee sensor stops its polling and removes its wall chip. */
export function updateMonitorIdentity(id: number, input: {
  name?: string | null; enabled?: boolean;
}): Promise<ApiResult<Monitor>> {
  return request(`/api/monitors/${id}/identity`, { method: 'PATCH', body: JSON.stringify(input) });
}
