import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import { GoveeSource } from '../../src/server/ingest/govee/goveeSource.js';

/**
 * GoveeSource against a real (local) HTTP server standing in for the Govee cloud —
 * `goveeBaseUrl` is the test-injectable base the settings schema exists for. start()
 * awaits the first poll, so every test drives exactly one deterministic poll (or
 * calls the private poll again via a second start/stop cycle) with no timers.
 */

interface FakeDevice { sku: string; device: string; deviceName: string }

let server: FastifyInstance;
let baseUrl: string;
let bus: EventBus;
let settings: SettingsStore;
let devices: FakeDevice[];
let stateRequests: { sku: string; device: string }[];
let deviceListRequests: number;
let tempFByDevice: Record<string, number>;

let discoveredEvents: EventMap['device_discovered'][];
let telemetryEvents: EventMap['telemetry'][];
let sensorReadings: EventMap['sensor_reading'][];
let statuses: EventMap['source_status'][];

let source: GoveeSource | null = null;
let sensorMonitorMap: Map<string, { enabled: boolean; name: string | null }>;

beforeEach(async () => {
  devices = [];
  stateRequests = [];
  deviceListRequests = 0;
  tempFByDevice = {};
  sensorMonitorMap = new Map();

  server = Fastify();
  server.get('/router/api/v1/user/devices', async () => {
    deviceListRequests += 1;
    return { data: devices };
  });
  server.post('/router/api/v1/device/state', async (req) => {
    const { payload } = req.body as { payload: { sku: string; device: string } };
    stateRequests.push(payload);
    return {
      payload: {
        capabilities: [
          { instance: 'sensorTemperature', state: { value: tempFByDevice[payload.device] ?? 39.2 } },
          { instance: 'sensorHumidity', state: { value: 55 } },
        ],
      },
    };
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  const db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  settings = new SettingsStore(db);
  settings.set('goveeBaseUrl', baseUrl);
  settings.set('govee', { apiKey: 'test-key' });

  bus = new EventBus();
  discoveredEvents = [];
  telemetryEvents = [];
  sensorReadings = [];
  statuses = [];
  bus.on('device_discovered', (e) => discoveredEvents.push(e));
  bus.on('telemetry', (e) => telemetryEvents.push(e));
  bus.on('sensor_reading', (e) => sensorReadings.push(e));
  bus.on('source_status', (e) => statuses.push(e));
});

afterEach(async () => {
  await source?.stop();
  source = null;
  await server.close();
});

function makeSource(): GoveeSource {
  source = new GoveeSource({
    bus,
    settings,
    sensorMonitor: (identifier) => sensorMonitorMap.get(identifier) ?? null,
    pollMs: 60_000,
  });
  return source;
}

describe('GoveeSource', () => {
  it('discovers each device as a govee_sensor monitor ref ONCE, re-announcing only on change', async () => {
    devices = [{ sku: 'H5179', device: 'AA:BB', deviceName: 'Keg room' }];
    const src = makeSource();
    await src.start();

    expect(discoveredEvents).toHaveLength(1);
    expect(discoveredEvents[0]).toMatchObject({
      monitor: { type: 'govee_sensor', identifier: 'AA:BB', portIndex: 0 },
      meta: { deviceName: 'Keg room', sku: 'H5179' },
    });

    // Same device list on the next poll: no re-announce (the discovery cache exists
    // so the StateManager's per-discovery ws broadcast doesn't fire every minute).
    await (src as any).poll();
    expect(discoveredEvents).toHaveLength(1);

    // A renamed device re-announces with the fresh meta.
    devices = [{ sku: 'H5179', device: 'AA:BB', deviceName: 'Renamed' }];
    await (src as any).poll();
    expect(discoveredEvents).toHaveLength(2);
    expect(discoveredEvents[1]!.meta).toMatchObject({ deviceName: 'Renamed' });
  });

  it('emits BOTH telemetry (persistence path) and sensor_reading (chips) per enabled device, F→C converted', async () => {
    devices = [{ sku: 'H5179', device: 'AA:BB', deviceName: 'Keg room' }];
    tempFByDevice['AA:BB'] = 39.2; // 4.0 °C
    await makeSource().start();

    expect(telemetryEvents).toHaveLength(1);
    expect(telemetryEvents[0]).toMatchObject({
      monitor: { type: 'govee_sensor', identifier: 'AA:BB', portIndex: 0 },
      temp: 4, humidity: 55,
    });
    expect(sensorReadings).toHaveLength(1);
    expect(sensorReadings[0]).toMatchObject({ sensorId: 'AA:BB', tempC: 4, humidity: 55 });
    expect(statuses.at(-1)).toMatchObject({ source: 'govee', healthy: true });
  });

  it('prefers the admin-set monitor name, then the Govee device name, then the id', async () => {
    devices = [
      { sku: 'H5179', device: 'NAMED', deviceName: 'Govee name' },
      { sku: 'H5179', device: 'BARE', deviceName: '' },
    ];
    sensorMonitorMap.set('NAMED', { enabled: true, name: 'Admin name' });
    await makeSource().start();

    const names = Object.fromEntries(sensorReadings.map((r) => [r.sensorId, r.name]));
    expect(names.NAMED).toBe('Admin name');
    expect(names.BARE).toBe('BARE');
  });

  it('a DISABLED sensor is still discovered but costs zero state requests and emits no readings', async () => {
    devices = [
      { sku: 'H5179', device: 'ON', deviceName: 'On' },
      { sku: 'H5179', device: 'OFF', deviceName: 'Off' },
    ];
    sensorMonitorMap.set('OFF', { enabled: false, name: null });
    await makeSource().start();

    expect(discoveredEvents.map((e) => e.monitor.identifier).sort()).toEqual(['OFF', 'ON']);
    expect(stateRequests.map((r) => r.device)).toEqual(['ON']);
    expect(telemetryEvents.map((e) => e.monitor.identifier)).toEqual(['ON']);
    expect(sensorReadings.map((r) => r.sensorId)).toEqual(['ON']);
    expect(statuses.at(-1)!.detail).toContain('1 disabled');
  });

  it('no API key: unconfigured status, zero requests', async () => {
    settings.set('govee', null);
    await makeSource().start();
    expect(statuses.at(-1)).toMatchObject({ source: 'govee', healthy: false, unconfigured: true });
    expect(deviceListRequests).toBe(0);
  });

  it('a failing device-list request reports unhealthy (configured, so it errors)', async () => {
    await server.close();
    await makeSource().start();
    const last = statuses.at(-1)!;
    expect(last.healthy).toBe(false);
    expect(last.unconfigured).toBeUndefined();
  });
});
