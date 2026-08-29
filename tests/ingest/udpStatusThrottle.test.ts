import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dgram from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { KegtronUdpSource } from '../../src/server/ingest/kegtron/udpSource.js';

// ---------------------------------------------------------------------------
// Server-hardening review, 2026-08-29: kegtron_udp used to emit a healthy
// `source_status` for EVERY datagram (5/sec/port during pours — each one written to the
// app log and fanned out over the bus). Now only the FIRST packet and one repeat per
// statusIntervalMs emit; transitions stay immediate (tests/ingest/statusThrottle.test.ts
// covers the pure decision logic). Same real-socket harness as udpSource.test.ts:
// unicast bind on 127.0.0.1 port 0, fixture packets via a plain dgram socket.
// ---------------------------------------------------------------------------

let bus: EventBus;
let events: { event: string; payload: any }[];
let settings: SettingsStore;
let source: KegtronUdpSource | null;
let client: dgram.Socket | null;

function byEvent(name: string): any[] {
  return events.filter((e) => e.event === name).map((e) => e.payload);
}

function lastPacketStatuses(): any[] {
  return byEvent('source_status').filter(
    (s) => s.healthy && typeof s.detail === 'string' && s.detail.startsWith('last packet'),
  );
}

async function makeSource(opts: Partial<ConstructorParameters<typeof KegtronUdpSource>[0]> = {}) {
  const src = new KegtronUdpSource({
    bus, settings, bindAddress: '127.0.0.1', port: 0, ...opts,
  });
  await src.start();
  return src;
}

function sendPacket(port: number, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    client!.send(buf, port, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
}

function packet(volDisp: number, portKey = 'port0'): unknown {
  return {
    serialNum: 'THROTTLE-1',
    temp: 4,
    [portKey]: { curServ: 0, volStart: 19000, volDisp, volSize: 19000 },
  };
}

beforeEach(() => {
  bus = new EventBus();
  events = [];
  for (const name of ['volume_update', 'device_discovered', 'source_status'] as const) {
    bus.on(name, (payload) => events.push({ event: name, payload }));
  }
  settings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
  settings.set('udpEnabled', true);
  source = null;
  client = dgram.createSocket('udp4');
});

afterEach(async () => {
  if (source) await source.stop();
  if (client) {
    await new Promise<void>((resolve) => client!.close(() => resolve()));
    client = null;
  }
  vi.restoreAllMocks();
});

describe('routine "last packet" status throttling', () => {
  it('emits for the first packet, then suppresses repeats inside the interval', async () => {
    source = await makeSource({ statusIntervalMs: 60_000 });
    const { port } = source.address()!;

    // Distinct volDisp per packet -> one volume_update each, a reliable "all three
    // datagrams were processed" sync point that doesn't depend on status emissions.
    await sendPacket(port, packet(100));
    await sendPacket(port, packet(200));
    await sendPacket(port, packet(300));
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(3));

    expect(lastPacketStatuses()).toHaveLength(1);
  });

  it('a zero interval restores per-datagram emission (repeats are interval-gated, not dropped)', async () => {
    source = await makeSource({ statusIntervalMs: 0 });
    const { port } = source.address()!;

    await sendPacket(port, packet(100));
    await sendPacket(port, packet(200));
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(2));

    expect(lastPacketStatuses()).toHaveLength(2);
  });
});

describe('out-of-range port keys (Pro hardware maxes out at port3)', () => {
  it('drops a hostile port index instead of minting a phantom monitor, keeping valid ports', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    source = await makeSource();
    const { port } = source.address()!;

    await sendPacket(port, {
      serialNum: 'THROTTLE-1',
      temp: 4,
      port0: { curServ: 0, volStart: 19000, volDisp: 100, volSize: 19000 },
      port999999: { curServ: 0, volStart: 19000, volDisp: 100, volSize: 19000 },
    });
    await vi.waitFor(() => expect(byEvent('device_discovered').length).toBeGreaterThan(0));

    const discoveredPorts = byEvent('device_discovered').map((d) => d.monitor.portIndex);
    expect(discoveredPorts).toEqual([0]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('out-of-range port index 999999'));
  });
});
