import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import type { MotionSourceRegistry } from '../../src/server/core/motionSources.js';
import type { BleScanner, BleSubscriber, NoblePeripheral } from '../../src/server/ingest/ble/scanner.js';
import { BleMotionSource } from '../../src/server/ingest/bleMotion.js';
import { BTHOME_SERVICE_UUID } from '../../src/server/ingest/bthome.js';

// Same "fake records the acquire() call, hands back a release spy" seam as every other
// BleScanner-consuming source's tests (bleSource.test.ts/proBleSource.test.ts exercise
// the real BleScanner + a FakeNoble instead, since THEY own noble import/scan lifecycle
// -- BleMotionSource never does, so faking BleScanner itself directly is the right
// altitude here, per the brief).
function fakeScanner(): { scanner: BleScanner; getSub: () => BleSubscriber; release: ReturnType<typeof vi.fn> } {
  let sub: BleSubscriber | null = null;
  const release = vi.fn(async () => {});
  const acquire = vi.fn(async (s: BleSubscriber) => {
    sub = s;
    return release;
  });
  return { scanner: { acquire } as unknown as BleScanner, getSub: () => sub!, release };
}

const svc = (...bytes: number[]) => Buffer.from(bytes);

/** A BTHome motion advert: device-info byte 0x40 (unencrypted) + a single motion (0x21)
 * object. `uuid` defaults to the short form; a test overrides it with the long 128-bit
 * form to prove normalization. */
function motionPeripheral(opts: { motion: boolean; address?: string; uuid?: string }): NoblePeripheral {
  return {
    address: opts.address,
    advertisement: {
      serviceData: [{ uuid: opts.uuid ?? BTHOME_SERVICE_UUID, data: svc(0x40, 0x21, opts.motion ? 0x01 : 0x00) }],
    },
  };
}

describe('BleMotionSource', () => {
  let bus: EventBus;
  let registry: { trigger: ReturnType<typeof vi.fn>; markHealth: ReturnType<typeof vi.fn> };
  let statuses: EventMap['source_status'][];

  beforeEach(() => {
    bus = new EventBus();
    statuses = [];
    bus.on('source_status', (e) => statuses.push(e));
    registry = { trigger: vi.fn(), markHealth: vi.fn() };
  });

  it('acquires the shared scanner on start()', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-1', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    expect(getSub()).toBeTruthy();
  });

  it('motion:true triggers a matching-MAC source and an any-MAC source, but not a non-matching MAC', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [
        { id: 'ble-any', mac: null },
        { id: 'ble-match', mac: 'AA:BB:CC:DD:EE:FF' },
        { id: 'ble-other', mac: '11:22:33:44:55:66' },
      ],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onPeripheral(motionPeripheral({ motion: true, address: 'aa:bb:cc:dd:ee:ff' }));

    expect(registry.trigger).toHaveBeenCalledWith('ble-any');
    expect(registry.trigger).toHaveBeenCalledWith('ble-match');
    expect(registry.trigger).not.toHaveBeenCalledWith('ble-other');
    expect(registry.trigger).toHaveBeenCalledTimes(2);
  });

  it('the long-form 128-bit BTHome service UUID normalizes the same as the short form', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-any', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onPeripheral(motionPeripheral({ motion: true, uuid: '0000fcd2-0000-1000-8000-00805f9b34fb' }));

    expect(registry.trigger).toHaveBeenCalledWith('ble-any');
  });

  it('motion:false is ignored -- no trigger', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-any', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onPeripheral(motionPeripheral({ motion: false }));

    expect(registry.trigger).not.toHaveBeenCalled();
  });

  it('an encrypted advert does not trigger', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-any', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onPeripheral({
      address: 'aa:bb:cc:dd:ee:ff',
      advertisement: { serviceData: [{ uuid: BTHOME_SERVICE_UUID, data: svc(0x41, 0xde, 0xad) }] },
    });

    expect(registry.trigger).not.toHaveBeenCalled();
  });

  it('logs an encrypted advert once per MAC, not once per advert', async () => {
    const { scanner, getSub } = fakeScanner();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const source = new BleMotionSource({
        sources: [{ id: 'ble-any', mac: null }],
        scanner, registry: registry as unknown as MotionSourceRegistry, bus,
      });
      await source.start();
      const peripheral: NoblePeripheral = {
        address: 'aa:bb:cc:dd:ee:ff',
        advertisement: { serviceData: [{ uuid: BTHOME_SERVICE_UUID, data: svc(0x41, 0xde, 0xad) }] },
      };
      getSub().onPeripheral(peripheral);
      getSub().onPeripheral(peripheral);
      getSub().onPeripheral(peripheral);

      expect(debugSpy).toHaveBeenCalledTimes(1);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('ignores a peripheral with no BTHome service data at all', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-any', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onPeripheral({
      address: 'aa:bb:cc:dd:ee:ff',
      advertisement: { serviceData: [{ uuid: 'deadbeef', data: svc(0x40) }] },
    });
    getSub().onPeripheral({ address: 'aa:bb:cc:dd:ee:ff' });

    expect(registry.trigger).not.toHaveBeenCalled();
  });

  it("onAdapter(false, 'no adapter') emits source_status and marks every configured ble source unhealthy", async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-1', mac: null }, { id: 'ble-2', mac: 'aa:bb:cc:dd:ee:ff' }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onAdapter(false, 'no adapter');

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_ble', healthy: false, detail: 'no adapter' });
    expect(registry.markHealth).toHaveBeenCalledWith('ble-1', false, 'no adapter');
    expect(registry.markHealth).toHaveBeenCalledWith('ble-2', false, 'no adapter');
  });

  it('onAdapter(true, ...) reports healthy for every configured source', async () => {
    const { scanner, getSub } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-1', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    getSub().onAdapter(true, 'scanning');

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_ble', healthy: true, detail: 'scanning' });
    expect(registry.markHealth).toHaveBeenCalledWith('ble-1', true, 'scanning');
  });

  it('stop() releases the scanner subscription', async () => {
    const { scanner, release } = fakeScanner();
    const source = new BleMotionSource({
      sources: [{ id: 'ble-1', mac: null }],
      scanner, registry: registry as unknown as MotionSourceRegistry, bus,
    });
    await source.start();
    await source.stop();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('a failed acquire() reports unhealthy without throwing', async () => {
    const acquire = vi.fn(async () => { throw new Error('import timed out'); });
    const source = new BleMotionSource({
      sources: [{ id: 'ble-1', mac: null }],
      scanner: { acquire } as unknown as BleScanner,
      registry: registry as unknown as MotionSourceRegistry, bus,
    });

    await expect(source.start()).resolves.toBeUndefined();
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_ble', healthy: false });
    expect(statuses.at(-1)!.detail).toMatch(/import timed out/);
    expect(registry.markHealth).toHaveBeenCalledWith('ble-1', false, expect.stringMatching(/import timed out/));
  });
});
