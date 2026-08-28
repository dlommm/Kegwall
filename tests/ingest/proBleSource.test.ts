import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import {
  KegtronProBleSource, decodeProAdvert, proNameSuffix,
} from '../../src/server/ingest/kegtron/proBleSource.js';
import { Gen1BleSource } from '../../src/server/ingest/gen1/bleSource.js';
import { BleScanner } from '../../src/server/ingest/ble/scanner.js';
import { reconcileProMonitorByBleName, upsertMonitor } from '../../src/server/db/monitors.js';

// ---------------------------------------------------------------------------
// Pro advert construction — byte layout per docs/kegtron/pro-ble-format.md (our own
// reverse-engineering; captured from a real KT-420). The worked example from that doc
// is asserted verbatim below.
// ---------------------------------------------------------------------------

function buildProAdvert(opts: {
  kegSize: number; volStart: number; volDisp: number; portIndex: number; portName: string;
  mfrId?: number;
}): Buffer {
  const raw = Buffer.alloc(29);
  raw.writeUInt16LE(opts.mfrId ?? 0x0000, 0);
  const payload = raw.subarray(2);
  payload.writeUInt16BE(opts.kegSize, 0);
  payload.writeUInt16BE(opts.volStart, 3);
  payload.writeUInt16BE(opts.volDisp, 6);
  payload.writeUInt8(((0xc + opts.portIndex) << 4) | 0x1, 8);
  payload.write(opts.portName.slice(0, 18), 9, 'ascii');
  return raw;
}

describe('decodeProAdvert', () => {
  it("decodes the format doc's worked example (port 2, Belgian White)", () => {
    // 4c66 00 4c66 00 6d11 e1 "Belgian White" — size 19558, start 19558, disp 27921.
    const raw = Buffer.alloc(29);
    raw.writeUInt16LE(0x0000, 0);
    Buffer.from('4c66004c66006d11e1', 'hex').copy(raw, 2);
    raw.write('Belgian White', 11, 'ascii');
    expect(decodeProAdvert(raw, 'Kegtron-010016')).toEqual({
      portIndex: 2,
      sizeMl: 19558,
      volStartMl: 19558,
      volDispensedMl: 27921, // odometer EXCEEDS start — never auto-reset on swaps
      portName: 'Belgian White',
    });
  });

  it('decodes all four port nibbles (0xC1/0xD1/0xE1/0xF1)', () => {
    for (const portIndex of [0, 1, 2, 3]) {
      const advert = buildProAdvert({
        kegSize: 29337, volStart: 29337, volDisp: 100, portIndex, portName: `Port ${portIndex}`,
      });
      expect(decodeProAdvert(advert, 'Kegtron-010016')?.portIndex).toBe(portIndex);
    }
  });

  it('truncates the port name at the 18-byte field width', () => {
    const advert = buildProAdvert({
      kegSize: 19558, volStart: 19558, volDisp: 0, portIndex: 0,
      portName: 'Sapporo Premium Beer',
    });
    expect(decodeProAdvert(advert, 'Kegtron-010016')?.portName).toBe('Sapporo Premium Be');
  });

  it('rejects wrong/missing local names (company id 0x0000 alone is too generic)', () => {
    const advert = buildProAdvert({ kegSize: 1, volStart: 1, volDisp: 1, portIndex: 0, portName: 'x' });
    expect(decodeProAdvert(advert, undefined)).toBeNull();
    expect(decodeProAdvert(advert, 'Kegtron 010016')).toBeNull(); // Gen 1 spacing
    expect(decodeProAdvert(advert, 'SomeOtherDevice')).toBeNull();
  });

  it('rejects wrong company id, wrong length, and out-of-range port nibbles', () => {
    const wrongMfr = buildProAdvert({ kegSize: 1, volStart: 1, volDisp: 1, portIndex: 0, portName: 'x', mfrId: 0xffff });
    expect(decodeProAdvert(wrongMfr, 'Kegtron-010016')).toBeNull();
    expect(decodeProAdvert(Buffer.alloc(10), 'Kegtron-010016')).toBeNull();
    expect(decodeProAdvert(Buffer.alloc(0), 'Kegtron-010016')).toBeNull();
    const badNibble = buildProAdvert({ kegSize: 1, volStart: 1, volDisp: 1, portIndex: 0, portName: 'x' });
    badNibble.writeUInt8(0x51, 10); // high nibble 0x5 — below the 0xC base
    expect(decodeProAdvert(badNibble, 'Kegtron-010016')).toBeNull();
  });
});

describe('proNameSuffix', () => {
  it('strips the Kegtron- prefix', () => {
    expect(proNameSuffix('Kegtron-010016')).toBe('010016');
  });
});

describe('reconcileProMonitorByBleName', () => {
  let db: Database.Database;
  beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

  it('resolves an unambiguous serial-suffix match to the cloud identifier', () => {
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'mdash-abc', portIndex: 2 }, { serial: '2001010016' });
    expect(reconcileProMonitorByBleName(db, '010016', 2)).toEqual({
      type: 'kegtron_pro', identifier: 'mdash-abc', portIndex: 2,
    });
  });

  it('prefers the cloud row over a lingering udp: fallback row for the same serial', () => {
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'udp:2001010016', portIndex: 0 }, { serial: '2001010016' });
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'mdash-abc', portIndex: 0 }, { serial: '2001010016' });
    expect(reconcileProMonitorByBleName(db, '010016', 0)?.identifier).toBe('mdash-abc');
  });

  it('returns null on no match, ambiguous match, or empty suffix', () => {
    expect(reconcileProMonitorByBleName(db, '010016', 0)).toBeNull();
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'mdash-a', portIndex: 0 }, { serial: '2001010016' });
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'mdash-b', portIndex: 0 }, { serial: '9999010016' });
    expect(reconcileProMonitorByBleName(db, '010016', 0)).toBeNull();
    expect(reconcileProMonitorByBleName(db, '', 0)).toBeNull();
  });

  it('never resolves to a ble: fallback row (self-reference guard)', () => {
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'ble:aa:bb', portIndex: 0 }, { serial: '2001010016' });
    expect(reconcileProMonitorByBleName(db, '010016', 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KegtronProBleSource lifecycle — FakeNoble via the scanner's nobleFactory seam, the
// same "no real BLE in CI" contract bleSource.test.ts established.
// ---------------------------------------------------------------------------

class FakeNoble extends EventEmitter {
  state = 'poweredOn';
  startScanningCalls = 0;
  stopScanningCalls = 0;
  async startScanningAsync(): Promise<void> { this.startScanningCalls++; }
  async stopScanningAsync(): Promise<void> { this.stopScanningCalls++; }
}

function peripheral(mac: string, name: string, manufacturerData: Buffer) {
  return {
    id: mac.replace(/:/g, ''),
    address: mac,
    advertisement: { manufacturerData, localName: name },
  };
}

let bus: EventBus;
let events: { event: string; payload: any }[];
let settings: SettingsStore;
let source: KegtronProBleSource | null;

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
  settings.set('proBleEnabled', true);
  source = null;
});

afterEach(async () => {
  if (source) await source.stop();
});

describe('KegtronProBleSource', () => {
  it('emits an unhealthy status and never loads noble when disabled in settings', async () => {
    settings.set('proBleEnabled', false);
    let factoryCalled = false;
    source = new KegtronProBleSource({
      bus, settings, nobleFactory: async () => { factoryCalled = true; return new FakeNoble() as any; },
    });
    await source.start();
    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'pro_ble', healthy: false, detail: expect.stringContaining('disabled') }),
    ]);
    expect(factoryCalled).toBe(false);
  });

  it('marks the source unhealthy when the noble import rejects', async () => {
    source = new KegtronProBleSource({
      bus, settings, nobleFactory: async () => { throw new Error("Cannot find module '@abandonware/noble'"); },
    });
    await expect(source.start()).resolves.toBeUndefined();
    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'pro_ble', healthy: false, detail: expect.stringContaining('noble') }),
    ]);
  });

  it('feeds readings through the synthesizer: volume_update always, pour_completed on a settled odometer jump', async () => {
    vi.useFakeTimers();
    try {
      const noble = new FakeNoble();
      source = new KegtronProBleSource({ bus, settings, nobleFactory: async () => noble as any });
      await source.start();
      expect(noble.startScanningCalls).toBe(1);

      const before = buildProAdvert({
        kegSize: 19558, volStart: 19558, volDisp: 591, portIndex: 1, portName: 'IPA',
      });
      noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', before));

      // No reconcile option → ble:{mac} fallback identity.
      expect(byEvent('device_discovered')).toEqual([
        expect.objectContaining({
          monitor: { type: 'kegtron_pro', identifier: 'ble:aa:bb:cc:dd:ee:ff', portIndex: 1 },
          portName: 'IPA',
        }),
      ]);
      expect(byEvent('volume_update')).toHaveLength(1);

      // The real captured pour: 591 → 841 in ONE jump at pour end (250 mL).
      const after = buildProAdvert({
        kegSize: 19558, volStart: 19558, volDisp: 841, portIndex: 1, portName: 'IPA',
      });
      noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', after));
      await vi.advanceTimersByTimeAsync(6_000); // > the synthesizer's 5s stabilize window

      expect(byEvent('pour_completed')).toEqual([
        expect.objectContaining({
          monitor: expect.objectContaining({ identifier: 'ble:aa:bb:cc:dd:ee:ff' }),
          volumeMl: 250,
          source: 'ble',
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lands on the reconciled cloud ref when the name suffix matches a known serial', async () => {
    const noble = new FakeNoble();
    source = new KegtronProBleSource({
      bus,
      settings,
      nobleFactory: async () => noble as any,
      reconcile: (suffix, portIndex) => (suffix === '010016'
        ? { type: 'kegtron_pro', identifier: 'mdash-abc', portIndex } : null),
    });
    await source.start();
    const advert = buildProAdvert({
      kegSize: 19558, volStart: 19558, volDisp: 100, portIndex: 0, portName: 'Lager',
    });
    noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', advert));
    expect(byEvent('volume_update')[0].monitor).toEqual({
      type: 'kegtron_pro', identifier: 'mdash-abc', portIndex: 0,
    });
  });

  it('does not cache the ble:{mac} fallback ref — reconcile re-runs until it succeeds, then caches', async () => {
    // Startup-order regression (doubled-pour bug): the first Pro advert routinely beats
    // cloud discovery creating the monitor row, so reconcile() returns null at that
    // moment. Pre-fix the ble:{mac} fallback was cached for the source's lifetime, so
    // every later BLE pour landed on the ble:{mac} monitor while cloud reported the same
    // pour on the mdash-id monitor — and PourDeduper can't collapse cross-monitor
    // duplicates. Post-fix, reconcile re-runs per advert until it matches (udpSource's
    // monitorRef contract), then the SUCCESSFUL ref is cached.
    const noble = new FakeNoble();
    let reconcileCalls = 0;
    let cloudDiscovered = false; // flips true to simulate cloud discovery landing later
    source = new KegtronProBleSource({
      bus,
      settings,
      nobleFactory: async () => noble as any,
      reconcile: (suffix, portIndex) => {
        reconcileCalls++;
        return cloudDiscovered && suffix === '010016'
          ? { type: 'kegtron_pro', identifier: 'mdash-abc', portIndex } : null;
      },
    });
    await source.start();
    const advert = buildProAdvert({
      kegSize: 19558, volStart: 19558, volDisp: 100, portIndex: 0, portName: 'Lager',
    });

    // Before cloud discovery: fallback identity, not cached.
    noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', advert));
    expect(byEvent('volume_update')[0].monitor.identifier).toBe('ble:aa:bb:cc:dd:ee:ff');
    expect(reconcileCalls).toBe(1);

    // Cloud discovery lands — the very next advert must converge onto the shared ref.
    cloudDiscovered = true;
    noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', advert));
    expect(byEvent('volume_update')[1].monitor.identifier).toBe('mdash-abc');
    expect(reconcileCalls).toBe(2);

    // The successful ref IS cached: a third advert re-uses it without another lookup.
    noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', advert));
    expect(byEvent('volume_update')[2].monitor.identifier).toBe('mdash-abc');
    expect(reconcileCalls).toBe(2);
  });

  it('ignores Gen 1 adverts and non-Kegtron traffic entirely', async () => {
    const noble = new FakeNoble();
    source = new KegtronProBleSource({ bus, settings, nobleFactory: async () => noble as any });
    await source.start();
    const gen1 = Buffer.alloc(29);
    gen1.writeUInt16LE(0xffff, 0);
    noble.emit('discover', peripheral('11:22:33:44:55:66', 'Kegtron 010099', gen1));
    noble.emit('discover', { advertisement: {} });
    expect(byEvent('volume_update')).toHaveLength(0);
    expect(byEvent('device_discovered')).toHaveLength(0);
  });
});

describe('shared BleScanner across Gen 1 + Pro sources', () => {
  it('imports noble once, fans out discover to both, and one stop() leaves the other alive', async () => {
    const noble = new FakeNoble();
    let imports = 0;
    const scanner = new BleScanner({ nobleFactory: async () => { imports++; return noble as any; } });
    settings.set('bleDirectEnabled', true);

    const gen1 = new Gen1BleSource({ bus, settings, scanner });
    source = new KegtronProBleSource({ bus, settings, scanner });
    await gen1.start();
    await source.start();
    expect(imports).toBe(1);
    expect(noble.startScanningCalls).toBe(1);

    // Stop Gen 1 — the Pro source's subscription must survive.
    await gen1.stop();
    expect(noble.stopScanningCalls).toBe(0); // refcount: still one subscriber
    const advert = buildProAdvert({
      kegSize: 19558, volStart: 19558, volDisp: 50, portIndex: 0, portName: 'Stout',
    });
    noble.emit('discover', peripheral('aa:bb:cc:dd:ee:ff', 'Kegtron-010016', advert));
    expect(byEvent('volume_update')).toHaveLength(1);

    // Last release actually stops the scan.
    await source.stop();
    source = null;
    expect(noble.stopScanningCalls).toBe(1);
  });
});
