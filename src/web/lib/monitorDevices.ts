import type { Monitor } from '../../server/db/monitors.js';

/**
 * A physical Kegtron DEVICE, derived from the flat per-port `monitors` rows: every
 * row sharing `(type, identifier)` is one device (a Kegtron Pro has 1-4 ports, a
 * Gen 1 unit 1-2). Presentation-level only — binding stays per port row.
 */
export interface MonitorDeviceGroup<M extends Monitor = Monitor> {
  /** `${type}:${identifier}` — stable per-device key for React lists / UI state. */
  key: string;
  type: Monitor['type'];
  identifier: string;
  /** Device friendly name — identical on every port row (see updateMonitorDeviceIdentity). */
  name: string | null;
  /** First non-null serial across ports (Gen 1 / UDP-synthetic rows have none). */
  serial: string | null;
  /** All port rows of the device, sorted by portIndex. */
  ports: M[];
  /** The port-0 row's id when present, else the lowest port's — the row to address
   * for device-level actions (telemetry fetch, rename, WiFi RSSI). */
  anchorId: number;
}

/** Groups the flat monitor list into physical devices; devices keep the order their
 * first row had in `monitors` (listMonitors sorts by type, identifier, port). */
export function groupMonitors<M extends Monitor>(monitors: M[]): MonitorDeviceGroup<M>[] {
  const groups = new Map<string, MonitorDeviceGroup<M>>();
  for (const m of monitors) {
    const key = `${m.type}:${m.identifier}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ports.push(m);
    } else {
      groups.set(key, {
        key, type: m.type, identifier: m.identifier, name: m.name, serial: m.serial,
        ports: [m], anchorId: m.id,
      });
    }
  }
  for (const g of groups.values()) {
    g.ports.sort((a, b) => a.portIndex - b.portIndex);
    g.anchorId = g.ports[0]!.id;
    g.name = g.ports.find((p) => p.name != null)?.name ?? null;
    g.serial = g.ports.find((p) => p.serial != null)?.serial ?? null;
  }
  return [...groups.values()];
}

export function deviceLabel(g: MonitorDeviceGroup): string {
  return g.name ?? g.identifier;
}
