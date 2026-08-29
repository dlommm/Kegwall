import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parseKegtronMqttMessage, GEN1_MAX_PORT_INDEX,
} from '../../src/server/ingest/gen1/mqttSource.js';
import { parsePacket } from '../../src/server/ingest/kegtron/udpSource.js';

// ---------------------------------------------------------------------------
// Port-index bounds (server-hardening review, 2026-08-29): both ingest parsers take a
// port index from an UNTRUSTED wire payload (a bridged MQTT message / a LAN UDP
// datagram), and an unbounded one minted a phantom monitor row per index via
// `device_discovered`. Gen 1 hardware has at most 2 ports (KT-100 single, KT-200 dual
// -> max index 1); Kegtron Pro has at most 4 (port0..port3, shadow.ts's range). Pure
// parser tests here; the live-socket UDP path is in udpStatusThrottle.test.ts.
// ---------------------------------------------------------------------------

afterEach(() => vi.restoreAllMocks());

function gen1Message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: 'KT-200',
    mac: 'AA:BB:CC:11:22:33',
    volume_start: 18.0,
    volume_dispensed: 0.5,
    keg_size: 19.0,
    ...overrides,
  };
}

describe('gen1 parseKegtronMqttMessage port bounds', () => {
  it('accepts every real Gen 1 port index (0..GEN1_MAX_PORT_INDEX)', () => {
    for (let i = 0; i <= GEN1_MAX_PORT_INDEX; i += 1) {
      expect(parseKegtronMqttMessage(gen1Message({ port_index: i }))?.portIndex).toBe(i);
    }
  });

  it('defaults a missing index to 0 (KT-100s genuinely have one port)', () => {
    expect(parseKegtronMqttMessage(gen1Message())?.portIndex).toBe(0);
  });

  it('drops (null) an explicit index beyond the hardware range, with a warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseKegtronMqttMessage(gen1Message({ port_index: GEN1_MAX_PORT_INDEX + 1 }))).toBeNull();
    expect(parseKegtronMqttMessage(gen1Message({ port_index: 999999 }))).toBeNull();
    expect(parseKegtronMqttMessage(gen1Message({ portIndex: 7 }))).toBeNull(); // camelCase alias too
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('port_index 999999 out of range'));
  });

  it('keeps the pre-existing safe fallback for a malformed (non-integer/negative) index', () => {
    expect(parseKegtronMqttMessage(gen1Message({ port_index: -3 }))?.portIndex).toBe(0);
    expect(parseKegtronMqttMessage(gen1Message({ port_index: 1.5 }))?.portIndex).toBe(0);
    expect(parseKegtronMqttMessage(gen1Message({ port_index: 'port9' }))?.portIndex).toBe(0);
  });
});

describe('kegtron pro parsePacket port bounds', () => {
  const portData = { curServ: 0, volStart: 19000, volDisp: 100, volSize: 19000 };

  it('accepts port0..port3 (the real hardware range)', () => {
    const parsed = parsePacket({
      serialNum: 'S1', port0: portData, port1: portData, port2: portData, port3: portData,
    });
    expect(parsed?.ports.map((p) => p.portIndex).sort()).toEqual([0, 1, 2, 3]);
  });

  it('individually skips an out-of-range port key (with a warn) without failing the packet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parsed = parsePacket({ serialNum: 'S1', port0: portData, port999999: portData });
    expect(parsed?.ports.map((p) => p.portIndex)).toEqual([0]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('out-of-range port index 999999'));
  });
});
