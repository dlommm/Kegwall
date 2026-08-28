import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { KegtronUdpSource } from '../../src/server/ingest/kegtron/udpSource.js';

// Built from docs/kegtron/UDPStreaming.pdf (see the fixture's own header comment for the
// full citation). Lines starting with '#' are fixture-file documentation, not payload.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '../fixtures/kegtron/udp-packets.jsonl',
);

function loadPackets(): unknown[] {
  return readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => JSON.parse(line));
}

const PACKETS = loadPackets();

let bus: EventBus;
let events: { event: string; payload: any }[];
let settings: SettingsStore;
let source: KegtronUdpSource | null;
let client: dgram.Socket | null;

// Fast test-only pour-end timeout (see udpSource.ts's KegtronUdpSourceOptions doc
// comment — additive beyond the brief's literal {bus,settings,isCloudHealthy,group,
// port,bindAddress} shape, same precedent as mdashClient's timeoutMs / cloudSource's
// reconnectBaseMs). Production default is 2000ms per the PDF's "2 seconds" tail.
const FAST_POUR_TIMEOUT_MS = 60;

function byEvent(name: string): any[] {
  return events.filter((e) => e.event === name).map((e) => e.payload);
}

function isCloudHealthyTrue(): boolean {
  return true;
}

async function makeSource(opts: Partial<ConstructorParameters<typeof KegtronUdpSource>[0]> = {}) {
  const src = new KegtronUdpSource({
    bus,
    settings,
    isCloudHealthy: isCloudHealthyTrue,
    bindAddress: '127.0.0.1',
    port: 0,
    pourTimeoutMs: FAST_POUR_TIMEOUT_MS,
    ...opts,
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

function sendRaw(port: number, raw: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(raw, 'utf8');
    client!.send(buf, port, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
}

beforeEach(() => {
  bus = new EventBus();
  events = [];
  for (const name of [
    'volume_update', 'pour_started', 'pour_progress', 'pour_completed', 'telemetry',
    'source_status',
  ] as const) {
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
});

describe('KegtronUdpSource.start() with udpEnabled=false', () => {
  it('emits an unhealthy source_status and does not bind a socket', async () => {
    settings.set('udpEnabled', false);
    source = await makeSource();

    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'kegtron_udp', healthy: false, detail: expect.stringContaining('disabled') }),
    ]);
    expect(source.address()).toBeNull();
  });
});

describe('KegtronUdpSource.start() when the socket cannot bind', () => {
  it('still resolves (never hangs SourceManager.startAll) and reports unhealthy', async () => {
    // Regression: bindSocket()'s promise only settled inside the bind() SUCCESS callback,
    // so a bind failure left start() pending forever — startAll's sequential await never
    // reached any source registered after UDP, and a settings-save's restartSourcesIfLive
    // hung the PATCH request with it. 203.0.113.1 (TEST-NET-3) is not a local interface,
    // so bind() fails with EADDRNOTAVAIL via the socket's async 'error' event.
    source = await makeSource({ bindAddress: '203.0.113.1' });

    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'kegtron_udp', healthy: false, detail: expect.stringContaining('socket error') }),
    ]);
    expect(source.address()).toBeNull();
  });
});

describe('KegtronUdpSource full pour replay', () => {
  it('replays the fixture and emits pour_started -> N pour_progress -> pour_completed with the final curServ, plus volume_update/telemetry', async () => {
    source = await makeSource();
    const addr = source.address();
    expect(addr).not.toBeNull();

    for (const packet of PACKETS) {
      await sendPacket(addr!.port, packet);
    }

    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(1));

    // pour_started fires exactly once, for port0 (the first curServ>0 sample, num=3).
    expect(byEvent('pour_started')).toHaveLength(1);
    expect(byEvent('pour_started')[0]).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: '2001011234', portIndex: 0 },
    });

    // pour_progress fires once per strictly-increasing curServ sample: 48,112,180,249,310,355.
    const progress = byEvent('pour_progress');
    expect(progress.map((p) => p.curServMl)).toEqual([48, 112, 180, 249, 310, 355]);
    for (const p of progress) {
      expect(p.monitor).toEqual({ type: 'kegtron_pro', identifier: '2001011234', portIndex: 0 });
    }

    // pour_completed carries the final accumulated curServ (355mL), source 'udp' — ALWAYS
    // emitted per the binding design decision (record-level dedupe in StateManager's
    // PourDeduper is the backstop, not a suppress-at-emit-time check against isCloudHealthy).
    const completed = byEvent('pour_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: '2001011234', portIndex: 0 },
      volumeMl: 355,
      source: 'udp',
    });
    expect(completed[0].durationMs).toBeGreaterThanOrEqual(0);

    // The trailing zero packet (num=10) is idempotent — no second pour_completed/started.
    expect(byEvent('pour_started')).toHaveLength(1);

    // volume_update fires for port0's initial idle sample and again once volDisp jumps
    // from 6934 -> 7289 on the post-pour packet (num=9); port1's single idle sample also
    // produces exactly one volume_update.
    const volUpdates = byEvent('volume_update');
    const port0Updates = volUpdates.filter((v) => v.monitor.portIndex === 0);
    const port1Updates = volUpdates.filter((v) => v.monitor.portIndex === 1);
    expect(port0Updates.map((v) => v.volDispensedMl)).toEqual([6934, 7289]);
    expect(port1Updates).toHaveLength(1);
    expect(port1Updates[0]).toMatchObject({ volStartMl: 5000, volDispensedMl: 1200, sizeMl: 19700 });

    // telemetry fires only on change: 20.5 (num=1) then 20.6 (num=6) — not once per packet.
    const telemetry = byEvent('telemetry');
    expect(telemetry.map((t) => t.temp)).toEqual([20.5, 20.6]);
    for (const t of telemetry) {
      expect(t.humidity).toBeNull();
      expect(t.monitor).toEqual({ type: 'kegtron_pro', identifier: '2001011234', portIndex: 0 });
    }

    // At least one healthy source_status was emitted (bind success).
    expect(byEvent('source_status').some((s) => s.healthy === true)).toBe(true);
  });
});

describe('KegtronUdpSource pour-end via timeout (dropped packets)', () => {
  it('ends the pour after pourTimeoutMs with no further packets for that port, using the last known curServ as the final volume', async () => {
    source = await makeSource();
    const addr = source.address();

    await sendPacket(addr!.port, {
      num: 1, serialNum: 'SN-TIMEOUT', portCount: 1, temp: 18,
      port0: { curServ: 90, volStart: 0, volDisp: 0, volSize: 5000 },
    });
    await vi.waitFor(() => expect(byEvent('pour_started')).toHaveLength(1));

    // No more packets arrive for this port — after pourTimeoutMs, the source treats the
    // pour as ended (UDP packet loss safety net, per the PDF's "2s with no packet" case).
    await vi.waitFor(
      () => expect(byEvent('pour_completed')).toHaveLength(1),
      { timeout: FAST_POUR_TIMEOUT_MS * 10 },
    );
    expect(byEvent('pour_completed')[0]).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: 'SN-TIMEOUT', portIndex: 0 },
      volumeMl: 90,
      source: 'udp',
    });
  });
});

describe('KegtronUdpSource malformed packets', () => {
  it('ignores invalid JSON, staying healthy and still processing subsequent valid packets', async () => {
    source = await makeSource();
    const addr = source.address();

    await sendRaw(addr!.port, 'not json at all {{{');
    // Give the malformed packet a moment to be (safely) dropped.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(byEvent('pour_started')).toHaveLength(0);
    expect(byEvent('source_status').every((s) => s.healthy === true)).toBe(true);

    // Source keeps working afterwards.
    await sendPacket(addr!.port, {
      num: 1, serialNum: 'SN-OK', portCount: 1, temp: 21,
      port0: { curServ: 5, volStart: 0, volDisp: 0, volSize: 1000 },
    });
    await vi.waitFor(() => expect(byEvent('pour_started')).toHaveLength(1));
  });

  it('ignores well-formed JSON that is missing serialNum, without crashing', async () => {
    source = await makeSource();
    const addr = source.address();

    await sendPacket(addr!.port, { num: 1, portCount: 1, temp: 21, port0: { curServ: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(byEvent('pour_started')).toHaveLength(0);
    expect(byEvent('source_status').every((s) => s.healthy === true)).toBe(true);
  });

  it('tolerates a garbage port<i> value by skipping just that port, not the whole packet', async () => {
    source = await makeSource();
    const addr = source.address();

    await sendPacket(addr!.port, {
      num: 1, serialNum: 'SN-MIXED', portCount: 2, temp: 21,
      port0: 'not an object',
      port1: { curServ: 12, volStart: 0, volDisp: 0, volSize: 500 },
    });
    await vi.waitFor(() => expect(byEvent('pour_started')).toHaveLength(1));
    expect(byEvent('pour_started')[0].monitor.portIndex).toBe(1);
  });
});

describe('KegtronUdpSource.stop()', () => {
  it('closes the socket and cancels pending per-port timers so no further events fire', async () => {
    source = await makeSource();
    const addr = source.address();

    await sendPacket(addr!.port, {
      num: 1, serialNum: 'SN-STOP', portCount: 1, temp: 18,
      port0: { curServ: 90, volStart: 0, volDisp: 0, volSize: 5000 },
    });
    await vi.waitFor(() => expect(byEvent('pour_started')).toHaveLength(1));

    await source.stop();
    expect(source.address()).toBeNull();

    // Wait past the (fast) pour timeout window — the pending timer must have been
    // cancelled by stop(), so no pour_completed should ever arrive for it.
    await new Promise((resolve) => setTimeout(resolve, FAST_POUR_TIMEOUT_MS * 5));
    expect(byEvent('pour_completed')).toHaveLength(0);

    source = null; // already stopped; afterEach should not double-stop problematically
  });
});

// A bound socket that hears nothing is the failure mode that used to be invisible: the
// source kept reporting "listening on 0.0.0.0:50505" forever, so a dropped multicast
// membership or a container moved off host networking looked identical to a quiet wall.
describe('KegtronUdpSource staleness', () => {
  const FAST_REJOIN_MS = 20;
  const FAST_STALE_MS = 60;

  it('reports itself unhealthy when no packet has EVER arrived since bind', async () => {
    source = await makeSource({ rejoinIntervalMs: FAST_REJOIN_MS, staleAfterMs: FAST_STALE_MS });

    await vi.waitFor(() => {
      const stale = byEvent('source_status').find((s) => s.healthy === false);
      expect(stale?.detail).toMatch(/no packet has EVER arrived/);
    });
  });

  it('reports itself unhealthy when a live stream stops, and recovers when it resumes', async () => {
    source = await makeSource({ rejoinIntervalMs: FAST_REJOIN_MS, staleAfterMs: FAST_STALE_MS });
    const addr = source.address();
    const packet = {
      num: 1, serialNum: 'SN-STALE', portCount: 1, temp: 4,
      port0: { curServ: 0, volStart: 5000, volDisp: 100, volSize: 5000 },
    };

    await sendPacket(addr!.port, packet);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));

    await vi.waitFor(() => {
      const stale = byEvent('source_status').find((s) => s.healthy === false);
      expect(stale?.detail).toMatch(/no packets for/);
    });

    // A packet after the gap puts the source back to healthy — the status must not stay
    // latched at "the stream stopped" once traffic returns.
    await sendPacket(addr!.port, packet);
    await vi.waitFor(() => {
      const last = byEvent('source_status').at(-1);
      expect(last?.healthy).toBe(true);
    });
  });

  it('stays healthy while packets keep arriving', async () => {
    source = await makeSource({ rejoinIntervalMs: FAST_REJOIN_MS, staleAfterMs: 5_000 });
    const addr = source.address();
    await sendPacket(addr!.port, {
      num: 1, serialNum: 'SN-LIVE', portCount: 1, temp: 4,
      port0: { curServ: 0, volStart: 5000, volDisp: 100, volSize: 5000 },
    });
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));

    await new Promise((resolve) => setTimeout(resolve, FAST_REJOIN_MS * 4));
    expect(byEvent('source_status').every((s) => s.healthy === true)).toBe(true);
  });
});
