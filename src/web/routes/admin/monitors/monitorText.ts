import type { TapState } from '../../../../server/core/state.js';
import type { Monitor } from '../../../../server/db/monitors.js';
import type { MonitorDeviceGroup } from '../../../lib/monitorDevices';

export const TYPE_LABELS: Record<Monitor['type'], string> = {
  kegtron_pro: 'Kegtron Pro',
  kegtron_gen1: 'Kegtron Gen 1',
  govee_sensor: 'Govee sensor',
};

/** A device that hasn't reported for this long reads as "not heard from". */
export const QUIET_AFTER_MS = 10 * 60_000;

/** `meta.deviceName` — the sensor's name in Govee's own app, stamped at discovery.
 * Read defensively like `monitorFirmware` (meta is untyped JSON). */
export function goveeDeviceName(monitor: Monitor): string | null {
  const name = monitor.meta.deviceName;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

export function tapLabel(tap: TapState): string {
  return tap.tapName ?? `Tap ${tap.tapNumber}`;
}

/** Dialog copy for a single port of a device — "Main kegerator, port 2". */
export function portLabel(deviceName: string, monitor: Monitor): string {
  return `${deviceName}, port ${monitor.portIndex}`;
}

/** `monitor.meta.fw`/`.online` — stamped at cloud discovery (see shadow.ts's
 * `diffToEvents`, Phase 5 Task 0). `meta` is a plain `Record<string, unknown>` (it's
 * JSON under the hood — `db/monitors.ts` never narrows its shape), so these read it
 * defensively rather than trusting the field is present/well-typed (an older monitor row,
 * discovered before this field existed, or a Gen 1 monitor, simply has neither key). */
export function monitorFirmware(monitor: Monitor): string | null {
  const fw = monitor.meta.fw;
  return typeof fw === 'string' && fw.length > 0 ? fw : null;
}

export function monitorOnlineFromMeta(monitor: Monitor): boolean | null {
  const online = monitor.meta.online;
  return typeof online === 'boolean' ? online : null;
}

/** The freshest last-seen across a device's ports (each port row updates its own). */
export function deviceLastSeen(group: MonitorDeviceGroup): string | null {
  const seen = group.ports.map((p) => p.lastSeen).filter((s): s is string => s != null);
  return seen.length > 0 ? seen.sort().at(-1)! : null;
}

/** Whether an enabled device has reported recently enough to count as receiving. */
export function isReceiving(group: MonitorDeviceGroup, now: Date = new Date()): boolean {
  const seen = deviceLastSeen(group);
  return seen != null && now.getTime() - new Date(seen).getTime() <= QUIET_AFTER_MS;
}
