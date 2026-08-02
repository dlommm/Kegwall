import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { EventBus, type EventMap } from '../../src/server/core/events.js';
import type { MotionSourceRegistry } from '../../src/server/core/motionSources.js';
import { GpioMotionSource, parseGpiomonLine } from '../../src/server/ingest/gpioMotion.js';

describe('parseGpiomonLine', () => {
  it.each([
    ['event: RISING EDGE offset: 4 timestamp: [1234.5]', 'rising'],
    ['event: FALLING EDGE offset: 4 timestamp: [1234.5]', 'falling'],
    ['1234.567890 rising gpiochip0 4', 'rising'],
    ['1234.567890 falling gpiochip0 4', 'falling'],
    ['garbage', null],
  ])('%j → %j', (line, want) => {
    expect(parseGpiomonLine(line as string)).toBe(want);
  });
});

// Fake child = EventEmitter + PassThrough stdout/stderr + a `kill` spy, matching real
// Node's `ChildProcessWithoutNullStreams` shape closely enough for GpioMotionSource's
// purposes. `spawnFn` records every `[cmd, args]` call and returns one fake child per
// call, so a multi-source test can address each spawned child independently.
interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function fakeSpawn() {
  const calls: Array<[string, string[]]> = [];
  const children: FakeChild[] = [];
  const spawnFn = vi.fn((cmd: string, args: string[]) => {
    calls.push([cmd, args]);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    }) as FakeChild;
    children.push(child);
    return child;
  });
  return { spawnFn, calls, children };
}

describe('GpioMotionSource', () => {
  let bus: EventBus;
  let registry: { trigger: ReturnType<typeof vi.fn>; markHealth: ReturnType<typeof vi.fn> };
  let statuses: EventMap['source_status'][];

  beforeEach(() => {
    bus = new EventBus();
    statuses = [];
    bus.on('source_status', (e) => statuses.push(e));
    registry = { trigger: vi.fn(), markHealth: vi.fn() };
  });

  it('spawns one gpiomon child per source with [chip, String(line)] args', async () => {
    const { spawnFn, calls } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [
        { id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 },
        { id: 'gpio-2', chip: 'gpiochip1', line: 7, activeLow: false, debounceMs: 2000 },
      ],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    expect(calls).toEqual([
      ['gpiomon', ['gpiochip0', '4']],
      ['gpiomon', ['gpiochip1', '7']],
    ]);
  });

  it('rising edge triggers the registry; falling does not (activeLow=false)', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    const child = children[0]!;

    child.stdout.write('event: RISING EDGE offset: 4 timestamp: [1234.5]\n');
    expect(registry.trigger).toHaveBeenCalledWith('gpio-1');
    expect(registry.trigger).toHaveBeenCalledTimes(1);

    child.stdout.write('event: FALLING EDGE offset: 4 timestamp: [1234.6]\n');
    expect(registry.trigger).toHaveBeenCalledTimes(1); // still just the one, from rising
  });

  it('activeLow inverts the edge', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: true, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    const child = children[0]!;

    child.stdout.write('event: RISING EDGE offset: 4 timestamp: [1234.5]\n');
    expect(registry.trigger).not.toHaveBeenCalled();

    child.stdout.write('event: FALLING EDGE offset: 4 timestamp: [1234.6]\n');
    expect(registry.trigger).toHaveBeenCalledWith('gpio-1');
    expect(registry.trigger).toHaveBeenCalledTimes(1);
  });

  it('debounces repeated edges within debounceMs', async () => {
    vi.useFakeTimers();
    try {
      const { spawnFn, children } = fakeSpawn();
      const source = new GpioMotionSource({
        sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
        registry: registry as unknown as MotionSourceRegistry,
        bus,
        spawnFn: spawnFn as never,
      });
      await source.start();
      const child = children[0]!;

      child.stdout.write('event: RISING EDGE offset: 4 timestamp: [1.0]\n');
      expect(registry.trigger).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      child.stdout.write('event: RISING EDGE offset: 4 timestamp: [1.1]\n');
      expect(registry.trigger).toHaveBeenCalledTimes(1); // still within the 2000ms window

      vi.advanceTimersByTime(2001);
      child.stdout.write('event: RISING EDGE offset: 4 timestamp: [3.2]\n');
      expect(registry.trigger).toHaveBeenCalledTimes(2); // window elapsed -- second trigger
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces independently per source', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [
        { id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 },
        { id: 'gpio-2', chip: 'gpiochip0', line: 5, activeLow: false, debounceMs: 2000 },
      ],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();

    children[0]!.stdout.write('event: RISING EDGE offset: 4 timestamp: [1.0]\n');
    children[1]!.stdout.write('event: RISING EDGE offset: 5 timestamp: [1.0]\n');

    expect(registry.trigger).toHaveBeenCalledWith('gpio-1');
    expect(registry.trigger).toHaveBeenCalledWith('gpio-2');
    expect(registry.trigger).toHaveBeenCalledTimes(2);
  });

  it('ENOENT spawn error (spawnFn throws synchronously) reports unhealthy with actionable detail, never throws', async () => {
    const spawnFn = vi.fn(() => {
      throw Object.assign(new Error('spawn gpiomon ENOENT'), { code: 'ENOENT' });
    });
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });

    await expect(source.start()).resolves.toBeUndefined();

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: false });
    expect(statuses.at(-1)!.detail).toMatch(/gpiomon not found/i);
    expect(registry.markHealth).toHaveBeenCalledWith(
      'gpio-1', false, expect.stringMatching(/gpiomon not found/i),
    );
  });

  it("ENOENT spawn error (child emits 'error' asynchronously) reports unhealthy, never throws", async () => {
    const spawnFn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
      }) as FakeChild;
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn gpiomon ENOENT'), { code: 'ENOENT' })));
      return child;
    });
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });

    await expect(source.start()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: false });
    expect(statuses.at(-1)!.detail).toMatch(/gpiomon not found/i);
    expect(registry.markHealth).toHaveBeenCalledWith(
      'gpio-1', false, expect.stringMatching(/gpiomon not found/i),
    );
  });

  it('captures stderr into the unhealthy detail on a non-zero exit', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    const child = children[0]!;

    child.stderr.write('gpiochip0: No such device\n');
    child.emit('exit', 1);

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: false });
    expect(registry.markHealth).toHaveBeenCalledWith(
      'gpio-1', false, expect.stringContaining('No such device'),
    );
  });

  it('a clean (code 0) exit after stop() is not reported unhealthy', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    await source.stop();
    children[0]!.emit('exit', 0);

    expect(registry.markHealth).not.toHaveBeenCalled();
  });

  it('reports healthy on the first stdout line', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    children[0]!.stdout.write('garbage startup banner\n');

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: true });
    expect(registry.markHealth).toHaveBeenCalledWith('gpio-1', true, expect.any(String));
  });

  it('reports healthy after a clean 3s grace period with no output', async () => {
    vi.useFakeTimers();
    try {
      const { spawnFn } = fakeSpawn();
      const source = new GpioMotionSource({
        sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
        registry: registry as unknown as MotionSourceRegistry,
        bus,
        spawnFn: spawnFn as never,
      });
      await source.start();
      expect(registry.markHealth).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);
      expect(registry.markHealth).toHaveBeenCalledWith('gpio-1', true, expect.any(String));
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() kills every spawned child', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [
        { id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 },
        { id: 'gpio-2', chip: 'gpiochip0', line: 5, activeLow: false, debounceMs: 2000 },
      ],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    await source.stop();

    expect(children[0]!.kill).toHaveBeenCalled();
    expect(children[1]!.kill).toHaveBeenCalled();
  });
});
