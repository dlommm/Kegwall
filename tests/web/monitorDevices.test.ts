import { describe, it, expect } from 'vitest';
import { groupMonitors, deviceLabel } from '../../src/web/lib/monitorDevices';
import type { Monitor } from '../../src/server/db/monitors';

function makeMonitor(id: number, overrides: Partial<Monitor> = {}): Monitor {
  return {
    id, type: 'kegtron_pro', identifier: 'dev1', serial: null, portIndex: 0,
    tapId: null, lastSeen: null, meta: {}, name: null, enabled: true, ...overrides,
  };
}

describe('groupMonitors', () => {
  it('groups a 4-port Pro into one device with ports sorted by portIndex', () => {
    const groups = groupMonitors([
      makeMonitor(3, { portIndex: 2 }),
      makeMonitor(1, { portIndex: 0 }),
      makeMonitor(4, { portIndex: 3 }),
      makeMonitor(2, { portIndex: 1 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('kegtron_pro:dev1');
    expect(groups[0]!.ports.map((p) => p.portIndex)).toEqual([0, 1, 2, 3]);
    expect(groups[0]!.anchorId).toBe(1);
  });

  it('keeps different identifiers and types as separate devices', () => {
    const groups = groupMonitors([
      makeMonitor(1, { identifier: 'a' }),
      makeMonitor(2, { identifier: 'b' }),
      makeMonitor(3, { identifier: 'a', type: 'kegtron_gen1' }),
    ]);
    expect(groups.map((g) => g.key).sort()).toEqual(
      ['kegtron_gen1:a', 'kegtron_pro:a', 'kegtron_pro:b'],
    );
  });

  it('anchors on the lowest port when no port-0 row exists', () => {
    const groups = groupMonitors([
      makeMonitor(9, { portIndex: 3 }),
      makeMonitor(7, { portIndex: 1 }),
    ]);
    expect(groups[0]!.anchorId).toBe(7);
  });

  it('takes name and serial from whichever port row has one', () => {
    const groups = groupMonitors([
      makeMonitor(1, { portIndex: 0, name: null, serial: null }),
      makeMonitor(2, { portIndex: 1, name: 'Garage', serial: 'SN1' }),
    ]);
    expect(groups[0]!.name).toBe('Garage');
    expect(groups[0]!.serial).toBe('SN1');
  });

  it('deviceLabel prefers the friendly name, falling back to the identifier', () => {
    const [named] = groupMonitors([makeMonitor(1, { name: 'Garage' })]);
    const [unnamed] = groupMonitors([makeMonitor(2)]);
    expect(deviceLabel(named!)).toBe('Garage');
    expect(deviceLabel(unnamed!)).toBe('dev1');
  });
});
