import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDeviceShadow, diffToEvents } from '../../src/server/ingest/kegtron/shadow.js';

// Fixture nesting mirrors docs/kegtron/kegtron-pro.v2.yaml's GetDeviceShadow response
// schema exactly — it's a JSON transcription of the spec's own "Example KT-420" sample
// value (kegtron-pro.v2.yaml lines ~620-818): id -> shadow.state.reported.{config,
// config_readonly,online,ota}, with config.portN carrying beer metadata (userName/maker/
// style/abv/ibu/srm/volSize/tapLabel/state) and config_readonly.portN carrying volume/
// serving counters (volStart/volDisp/lastServing/dateTapped). See the block comment atop
// src/server/ingest/kegtron/shadow.ts for the full field map + line references.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '../fixtures/kegtron/device-shadow.json',
);
const fixture: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('parseDeviceShadow', () => {
  it('parses the fixture into a correct ParsedDevice', () => {
    const parsed = parseDeviceShadow(fixture);
    expect(parsed).not.toBeNull();
    const d = parsed!;
    expect(d.deviceId).toBe('device2');
    expect(d.serial).toBe('2001011234');
    expect(d.model).toBe('KT-420');
    expect(d.fw).toBe('20200507');
    expect(d.portCount).toBe(4);
    expect(d.temp).toBeCloseTo(8.2346);
    expect(d.humidity).toBeCloseTo(66.5665);
    expect(d.online).toBe(true);
    expect(d.ports).toHaveLength(4);

    expect(d.ports[0]).toEqual({
      portIndex: 0,
      name: 'King Cobra',
      maker: 'Anheuser-Busch',
      style: 'Malt Liquor',
      abv: 6,
      ibu: 11,
      srm: 4,
      volSizeMl: 58670,
      volStartMl: 10376,
      volDispensedMl: 6934,
      lastServingMl: 262,
      dateTapped: '2020/03/28',
      enabled: true,
    });

    const port3 = d.ports[3]!;
    expect(port3.name).toBe('Olde English 800');
    expect(port3.volDispensedMl).toBe(20481);
    expect(port3.lastServingMl).toBe(370);
  });

  it('returns null (never throws) on garbage input', () => {
    const garbageInputs: unknown[] = [null, undefined, 42, 'nonsense', [], {}, { id: 123 }, { id: 'x' }];
    for (const garbage of garbageInputs) {
      expect(() => parseDeviceShadow(garbage)).not.toThrow();
      expect(parseDeviceShadow(garbage)).toBeNull();
    }
  });

  it('tolerates missing/malformed ports without throwing', () => {
    const shadow = {
      id: 'device-partial',
      shadow: {
        state: {
          reported: {
            config: { port0: { userName: 'Solo Beer', state: 1 } },
            config_readonly: {
              portCount: 2,
              port0: { volStart: 5000, volDisp: 100, lastServing: 100, dateTapped: '2026/01/01' },
              port1: 'not-an-object', // malformed — must degrade to defaults, not throw or fail the parse
            },
            online: false,
          },
        },
      },
    };
    expect(() => parseDeviceShadow(shadow)).not.toThrow();
    const parsed = parseDeviceShadow(shadow);
    expect(parsed).not.toBeNull();
    expect(parsed!.portCount).toBe(2);
    expect(parsed!.ports).toHaveLength(2);
    expect(parsed!.ports[0]!.name).toBe('Solo Beer');
    expect(parsed!.ports[0]!.volDispensedMl).toBe(100);
    expect(parsed!.ports[1]).toEqual({
      portIndex: 1,
      name: null,
      maker: null,
      style: null,
      abv: null,
      ibu: null,
      srm: null,
      volSizeMl: null,
      volStartMl: 0,
      volDispensedMl: 0,
      lastServingMl: null,
      dateTapped: null,
      enabled: true,
    });
  });

  it('defaults to an empty device when config/config_readonly are entirely absent', () => {
    const parsed = parseDeviceShadow({ id: 'bare', shadow: { state: { reported: { online: true } } } });
    expect(parsed).toEqual({
      deviceId: 'bare',
      serial: null,
      model: null,
      fw: null,
      portCount: 0,
      temp: null,
      humidity: null,
      online: true,
      ports: [],
    });
  });
});

describe('diffToEvents', () => {
  const parsedFixture = parseDeviceShadow(fixture)!;

  it('emits device_discovered + volume_update per port, and telemetry, on first sight (prev null)', () => {
    const events = diffToEvents('device2', null, parsedFixture);
    const byEvent = (name: string) => events.filter((e) => e.event === name);
    expect(byEvent('device_discovered')).toHaveLength(4);
    expect(byEvent('volume_update')).toHaveLength(4);
    expect(byEvent('telemetry')).toHaveLength(1);
    expect(byEvent('pour_completed')).toHaveLength(0);

    const discovered = byEvent('device_discovered')[0]!;
    expect(discovered.payload).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
      serial: '2001011234',
      portName: 'King Cobra',
      meta: { maker: 'Anheuser-Busch', style: 'Malt Liquor', abv: 6 },
    });
  });

  it("emits one volume_update + one pour_completed when a port's volDisp and lastServing change", () => {
    const next = structuredClone(parsedFixture);
    next.ports[0]!.volDispensedMl = 7200;
    next.ports[0]!.lastServingMl = 266;

    const events = diffToEvents('device2', parsedFixture, next);
    expect(events).toHaveLength(2);

    const volumeEvent = events.find((e) => e.event === 'volume_update')!;
    expect(volumeEvent.payload).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
      volStartMl: 10376,
      volDispensedMl: 7200,
      sizeMl: 58670,
    });

    const pourEvent = events.find((e) => e.event === 'pour_completed')!;
    expect(pourEvent.payload).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
      volumeMl: 266,
      durationMs: null,
      source: 'cloud',
    });
  });

  it('emits nothing when nothing changed', () => {
    const next = structuredClone(parsedFixture);
    const events = diffToEvents('device2', parsedFixture, next);
    expect(events).toEqual([]);
  });

  it('does not emit pour_completed when lastServing changes but volDispensed does not increase', () => {
    const next = structuredClone(parsedFixture);
    next.ports[0]!.lastServingMl = 999; // changed, but volDispensedMl unchanged -> not a new pour
    const events = diffToEvents('device2', parsedFixture, next);
    expect(events).toEqual([]);
  });

  it('emits telemetry only when temp/humidity change relative to prev', () => {
    const next = structuredClone(parsedFixture);
    next.temp = 9.5;
    const events = diffToEvents('device2', parsedFixture, next);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('telemetry');
    expect(events[0]!.payload).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
      temp: 9.5,
      humidity: parsedFixture.humidity,
    });
  });
});
