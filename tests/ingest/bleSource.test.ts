import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { Gen1BleSource, decodeKegtronAdvert } from '../../src/server/ingest/gen1/bleSource.js';

// ---------------------------------------------------------------------------
// Byte layout ported EXACTLY from the real kegtron-ble reference decoder, fetched
// 2026-07-28 from
// https://raw.githubusercontent.com/Bluetooth-Devices/kegtron-ble/main/src/kegtron_ble/parser.py
// (see bleSource.ts's header comment for the full citation + byte-offset table). Summary:
//   MFR_ID = 0xFFFF (company identifier, little-endian, per the BLE Core Spec AD
//     structure for type 0xFF -- Kegtron's raw advert prefixes the 27-byte payload
//     below with this 2-byte LE company id; kegtron-ble's own `service_info
//     .manufacturer_data` is a dict keyed by company id with that prefix already
//     stripped, since it targets bleak/HA -- noble instead hands us the raw Buffer
//     WITH the prefix, so this fixture builder includes it and decodeKegtronAdvert()
//     is written to expect+validate it).
//   unpack(">HHHB20s", data): keg_size(u16 BE, bytes 0-1) / vol_start(u16 BE, bytes 2-3)
//     / vol_disp(u16 BE, bytes 4-5) / port(u8, byte 6) / port_name(20 bytes, 7-26).
//   port byte bit 6 (0x40): 0 => KT-100 (single port); 1 => KT-200 (dual port).
//   port byte bit 4 (0x10), KT-200 only: 0 => "port 1" (index 0); 1 => "port 2" (index 1).
//   port byte bit 0 (0x01): 0 => unconfigured (new device); 1 => configured.
// ---------------------------------------------------------------------------
function buildManufacturerData(opts: {
  companyId?: number;
  kegSize: number;
  volStart: number;
  volDisp: number;
  portByte: number;
  portName?: string;
}): Buffer {
  const buf = Buffer.alloc(2 + 27);
  buf.writeUInt16LE(opts.companyId ?? 0xffff, 0);
  buf.writeUInt16BE(opts.kegSize, 2);
  buf.writeUInt16BE(opts.volStart, 4);
  buf.writeUInt16BE(opts.volDisp, 6);
  buf.writeUInt8(opts.portByte, 8);
  const nameBuf = Buffer.alloc(20); // zero-filled -- matches the device's NUL-padded field
  if (opts.portName) nameBuf.write(opts.portName, 0, 'utf8');
  nameBuf.copy(buf, 9);
  return buf;
}

const PORT_BIT_CONFIGURED = 0x01;
const PORT_BIT_PORT2 = 0x10;
const PORT_BIT_KT200 = 0x40;

describe('decodeKegtronAdvert()', () => {
  it('decodes a KT-100 (single-port) advert', () => {
    const data = buildManufacturerData({
      kegSize: 18927, volStart: 5000, volDisp: 1000,
      portByte: PORT_BIT_CONFIGURED, // bit6=0 -> KT-100
      portName: 'Left Tap',
    });
    expect(decodeKegtronAdvert(data)).toEqual({
      model: 'KT-100',
      portIndex: 0,
      configured: true,
      sizeMl: 18927,
      volStartMl: 5000,
      volDispensedMl: 1000,
      portName: 'Left Tap',
    });
  });

  it('decodes a KT-200 (dual-port) advert for port 1 (index 0)', () => {
    const data = buildManufacturerData({
      kegSize: 19700, volStart: 5000, volDisp: 1200,
      portByte: PORT_BIT_KT200 | PORT_BIT_CONFIGURED, // bit6=1, bit4=0 -> "port 1"
    });
    expect(decodeKegtronAdvert(data)).toMatchObject({ model: 'KT-200', portIndex: 0, configured: true });
  });

  it('decodes a KT-200 (dual-port) advert for port 2 (index 1)', () => {
    const data = buildManufacturerData({
      kegSize: 19700, volStart: 3000, volDisp: 500,
      portByte: PORT_BIT_KT200 | PORT_BIT_PORT2 | PORT_BIT_CONFIGURED,
    });
    expect(decodeKegtronAdvert(data)).toMatchObject({ model: 'KT-200', portIndex: 1, configured: true });
  });

  it('reports configured:false for an unconfigured (new) device', () => {
    const data = buildManufacturerData({ kegSize: 0, volStart: 0, volDisp: 0, portByte: 0 });
    expect(decodeKegtronAdvert(data)).toMatchObject({ configured: false });
  });

  it('strips NUL padding from portName, and reports "" when entirely blank', () => {
    const data = buildManufacturerData({ kegSize: 100, volStart: 0, volDisp: 0, portByte: PORT_BIT_CONFIGURED });
    expect(decodeKegtronAdvert(data)?.portName).toBe('');
  });

  it('returns null for a wrong company id (not a Kegtron advert)', () => {
    const data = buildManufacturerData({
      companyId: 0x004c, // Apple's real company id, i.e. "some other BLE device"
      kegSize: 100, volStart: 0, volDisp: 0, portByte: PORT_BIT_CONFIGURED,
    });
    expect(decodeKegtronAdvert(data)).toBeNull();
  });

  it('returns null for a corrupt/short buffer (wrong length)', () => {
    expect(decodeKegtronAdvert(Buffer.alloc(10))).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(decodeKegtronAdvert(Buffer.alloc(0))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gen1BleSource lifecycle -- per the brief, "no real BLE in CI": every test here injects
// a fake `nobleFactory` in place of the real dynamic `@abandonware/noble` import, so none
// of this depends on real Bluetooth hardware/permissions. Verified empirically during
// this task (2026-07-28) that a bare `import('@abandonware/noble')` can HANG
// indefinitely in a sandboxed/headless environment (no adapter) rather than
// throw/reject -- not just fail -- which is why Gen1BleSource races the import against
// `importTimeoutMs` rather than relying on try/catch alone; the "hangs forever" test
// below exercises exactly that.
// ---------------------------------------------------------------------------

class FakeNoble extends EventEmitter {
  state = 'unknown';
  startScanningCalls = 0;
  stopScanningCalls = 0;
  async startScanningAsync(): Promise<void> {
    this.startScanningCalls++;
  }
  async stopScanningAsync(): Promise<void> {
    this.stopScanningCalls++;
  }
}

function discoverPeripheral(mac: string, manufacturerData: Buffer) {
  return { id: mac.replace(/:/g, ''), address: mac, advertisement: { manufacturerData } };
}

const KT200_PORT0_ADVERT = buildManufacturerData({
  kegSize: 18927, volStart: 5000, volDisp: 1000,
  portByte: PORT_BIT_KT200 | PORT_BIT_CONFIGURED,
});

let bus: EventBus;
let events: { event: string; payload: any }[];
let settings: SettingsStore;
let source: Gen1BleSource | null;
let bleActiveMacs: Set<string>;

function byEvent(name: string): any[] {
  return events.filter((e) => e.event === name).map((e) => e.payload);
}

beforeEach(() => {
  bus = new EventBus();
  events = [];
  for (const name of ['volume_update', 'device_discovered', 'pour_completed', 'source_status'] as const) {
    bus.on(name, (payload) => events.push({ event: name, payload }));
  }
  settings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
  settings.set('bleDirectEnabled', true);
  bleActiveMacs = new Set();
  source = null;
});

afterEach(async () => {
  if (source) await source.stop();
});

describe('Gen1BleSource.start() with bleDirectEnabled=false', () => {
  it('emits an unhealthy source_status and never attempts to load noble', async () => {
    settings.set('bleDirectEnabled', false);
    let factoryCalled = false;
    source = new Gen1BleSource({
      bus, settings, bleActiveMacs,
      nobleFactory: async () => { factoryCalled = true; return new FakeNoble() as any; },
    });
    await source.start();

    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'gen1_ble', healthy: false, detail: expect.stringContaining('disabled') }),
    ]);
    expect(factoryCalled).toBe(false);
  });
});

describe('Gen1BleSource.start() when the noble adapter is unavailable', () => {
  it('marks the source unhealthy (never crashes) when nobleFactory rejects', async () => {
    source = new Gen1BleSource({
      bus, settings, bleActiveMacs,
      nobleFactory: async () => { throw new Error('Cannot find module \'@abandonware/noble\''); },
    });
    await expect(source.start()).resolves.toBeUndefined();

    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'gen1_ble', healthy: false, detail: expect.stringContaining('noble') }),
    ]);
  });

  it('marks the source unhealthy (never hangs) when the noble import never resolves', async () => {
    source = new Gen1BleSource({
      bus, settings, bleActiveMacs,
      nobleFactory: () => new Promise(() => {}), // never settles -- simulates the observed hang
      importTimeoutMs: 30,
    });
    await expect(source.start()).resolves.toBeUndefined();

    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'gen1_ble', healthy: false, detail: expect.stringContaining('timed out') }),
    ]);
  });
});

describe('Gen1BleSource discover -> decode -> synthesize wiring', () => {
  it('feeds a decoded advert into volume_update/device_discovered and marks the MAC as BLE-active', async () => {
    const noble = new FakeNoble();
    source = new Gen1BleSource({ bus, settings, bleActiveMacs, nobleFactory: async () => noble as any });
    await source.start();

    noble.state = 'poweredOn';
    noble.emit('stateChange', 'poweredOn');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(noble.startScanningCalls).toBe(1);

    noble.emit('discover', discoverPeripheral('aa:bb:cc:11:22:33', KT200_PORT0_ADVERT));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(byEvent('volume_update')).toEqual([
      {
        monitor: { type: 'kegtron_gen1', identifier: 'aa:bb:cc:11:22:33', portIndex: 0 },
        volStartMl: 5000, volDispensedMl: 1000, sizeMl: 18927, ts: expect.any(String),
      },
    ]);
    expect(byEvent('device_discovered')).toHaveLength(1);
    expect(bleActiveMacs.has('aa:bb:cc:11:22:33')).toBe(true);
  });

  it('does not re-fire device_discovered for repeated adverts from the same MAC+port', async () => {
    const noble = new FakeNoble();
    source = new Gen1BleSource({ bus, settings, bleActiveMacs, nobleFactory: async () => noble as any });
    await source.start();
    noble.emit('stateChange', 'poweredOn');
    await new Promise((resolve) => setTimeout(resolve, 10));

    noble.emit('discover', discoverPeripheral('aa:bb:cc:11:22:33', KT200_PORT0_ADVERT));
    noble.emit('discover', discoverPeripheral('aa:bb:cc:11:22:33', KT200_PORT0_ADVERT));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(byEvent('device_discovered')).toHaveLength(1);
    expect(byEvent('volume_update')).toHaveLength(2);
  });

  it('ignores an advert with no manufacturerData or an undecodable payload, without crashing', async () => {
    const noble = new FakeNoble();
    source = new Gen1BleSource({ bus, settings, bleActiveMacs, nobleFactory: async () => noble as any });
    await source.start();
    noble.emit('stateChange', 'poweredOn');
    await new Promise((resolve) => setTimeout(resolve, 10));

    noble.emit('discover', { id: 'x', address: 'zz:zz:zz:zz:zz:zz', advertisement: {} });
    noble.emit('discover', discoverPeripheral('11:22:33:44:55:66', Buffer.alloc(5)));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(byEvent('volume_update')).toHaveLength(0);
    expect(byEvent('device_discovered')).toHaveLength(0);
  });

  it('stop() stops scanning and removes listeners so further discover events are ignored', async () => {
    const noble = new FakeNoble();
    source = new Gen1BleSource({ bus, settings, bleActiveMacs, nobleFactory: async () => noble as any });
    await source.start();
    noble.emit('stateChange', 'poweredOn');
    await new Promise((resolve) => setTimeout(resolve, 10));

    await source.stop();
    source = null;
    expect(noble.stopScanningCalls).toBe(1);

    noble.emit('discover', discoverPeripheral('aa:bb:cc:11:22:33', KT200_PORT0_ADVERT));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(byEvent('volume_update')).toHaveLength(0);
  });
});
