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

  it('a gpiomon that dies AFTER being reported healthy flips the source unhealthy', async () => {
    // Regression: once the healthy verdict was delivered, `finalReported` made every
    // later exit/error a silent no-op — a gpiomon that crashed hours in (OOM-kill, USB
    // GPIO expander reset) left the dashboard claiming "gpiomon running" forever while
    // motion was actually dead, the same claims-healthy-forever class the UDP source's
    // silence reporting fixed.
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
    expect(registry.markHealth).toHaveBeenCalledWith('gpio-1', true, expect.any(String));

    child.emit('exit', null, 'SIGKILL'); // died on its own — stop() was never called

    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: false });
    expect(registry.markHealth).toHaveBeenLastCalledWith(
      'gpio-1', false, expect.stringContaining('exited unexpectedly after running healthy'),
    );
    // The accurate post-healthy detail, not UNHEALTHY_DETAIL's "install libgpiod" advice
    // (wrong for a binary that WAS running), and no duplicate report for a second late
    // event from the same dead child.
    const reports = registry.markHealth.mock.calls.filter(([, healthy]) => healthy === false);
    child.emit('error', new Error('late duplicate'));
    expect(registry.markHealth.mock.calls.filter(([, healthy]) => healthy === false)).toHaveLength(reports.length);
  });

  // Final-review I3: gpiomon's CLI arg syntax changed between libgpiod v1 (positional
  // `<chip> <line>`, tried first) and v2 (`--chip <chip> <line>`) -- a host running the
  // "wrong" version for whichever form is tried first must get exactly ONE retry in the
  // other form before this source is ever reported unhealthy.
  describe('libgpiod v1/v2 retry (final-review I3)', () => {
    it('a v1-arg attempt that dies gets ONE retry in v2 (--chip) form, and is healthy on that retry\'s output', async () => {
      const { spawnFn, children, calls } = fakeSpawn();
      const source = new GpioMotionSource({
        sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
        registry: registry as unknown as MotionSourceRegistry,
        bus,
        spawnFn: spawnFn as never,
      });
      await source.start();

      children[0]!.emit('exit', 1, null); // v1-syntax gpiomon fails on a libgpiod-v2-only host

      expect(calls).toEqual([
        ['gpiomon', ['gpiochip0', '4']],
        ['gpiomon', ['--chip', 'gpiochip0', '4']],
      ]);
      expect(registry.markHealth).not.toHaveBeenCalled(); // no verdict yet -- the retry is still pending

      children[1]!.stdout.write('1234.567890 rising gpiochip0 4\n');

      expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: true });
      expect(registry.markHealth).toHaveBeenCalledTimes(1);
      expect(registry.markHealth).toHaveBeenCalledWith('gpio-1', true, expect.any(String));
    });

    it('both the v1 attempt and its v2 retry dying reports unhealthy exactly once, with a widened detail', async () => {
      const { spawnFn, children, calls } = fakeSpawn();
      const source = new GpioMotionSource({
        sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
        registry: registry as unknown as MotionSourceRegistry,
        bus,
        spawnFn: spawnFn as never,
      });
      await source.start();

      children[0]!.stderr.write('gpiomon: unrecognized option \'--chip\'\n');
      children[0]!.emit('exit', 1, null);
      children[1]!.stderr.write('gpiochip0: No such device\n');
      children[1]!.emit('exit', 1, null);

      expect(calls).toEqual([
        ['gpiomon', ['gpiochip0', '4']],
        ['gpiomon', ['--chip', 'gpiochip0', '4']],
      ]);
      const unhealthyStatuses = statuses.filter((s) => !s.healthy);
      expect(unhealthyStatuses).toHaveLength(1);
      expect(registry.markHealth).toHaveBeenCalledTimes(1);
      expect(registry.markHealth).toHaveBeenCalledWith(
        'gpio-1', false, expect.stringContaining('install libgpiod (v1 or v2)'),
      );
      // Only the LAST (retry) attempt's stderr is captured -- see reportUnhealthy's doc
      // comment.
      expect(registry.markHealth).toHaveBeenCalledWith(
        'gpio-1', false, expect.stringContaining('No such device'),
      );
    });

    it('stop() landing right after the v1 attempt dies (during the retry window) yields no health report', async () => {
      const { spawnFn, children, calls } = fakeSpawn();
      const source = new GpioMotionSource({
        sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
        registry: registry as unknown as MotionSourceRegistry,
        bus,
        spawnFn: spawnFn as never,
      });
      await source.start();

      children[0]!.emit('exit', 1, null); // v1 attempt dies -- synchronously spawns the v2 retry
      expect(calls).toEqual([
        ['gpiomon', ['gpiochip0', '4']],
        ['gpiomon', ['--chip', 'gpiochip0', '4']],
      ]);

      await source.stop();
      // A late exit on the retry child (e.g. the SIGTERM from stop()'s own kill()) must
      // not report anything either -- same `stopped` guard as every other post-stop()
      // event.
      children[1]!.emit('exit', null, 'SIGTERM');

      expect(registry.markHealth).not.toHaveBeenCalled();
      expect(statuses).toEqual([]);
    });

    it("error+exit double-firing on a SINGLE attempt (v1 or its v2 retry) still counts as just that one attempt's failure", async () => {
      const spawnFn = vi.fn(() => Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
      }) as FakeChild);
      const source = new GpioMotionSource({
        sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
        registry: registry as unknown as MotionSourceRegistry,
        bus,
        spawnFn: spawnFn as never,
      });
      await source.start();
      const first = spawnFn.mock.results[0]!.value as FakeChild;

      first.emit('error', Object.assign(new Error('spawn gpiomon ENOENT'), { code: 'ENOENT' }));
      first.emit('exit', null, null); // double-fire on the SAME (v1) attempt -- still one retry

      expect(spawnFn).toHaveBeenCalledTimes(2);
      expect(spawnFn.mock.calls[1]).toEqual(['gpiomon', ['--chip', 'gpiochip0', '4']]);
      expect(registry.markHealth).not.toHaveBeenCalled(); // the v2 retry hasn't failed yet

      const second = spawnFn.mock.results[1]!.value as FakeChild;
      second.emit('error', Object.assign(new Error('spawn gpiomon ENOENT'), { code: 'ENOENT' }));
      second.emit('exit', null, null); // double-fire on the v2 retry too -- still one final report

      const unhealthyStatuses = statuses.filter((s) => !s.healthy);
      expect(unhealthyStatuses).toHaveLength(1);
      expect(registry.markHealth).toHaveBeenCalledTimes(1);
      expect(registry.markHealth).toHaveBeenCalledWith(
        'gpio-1', false, expect.stringMatching(/gpiomon failed/i),
      );
    });
  });

  it('ENOENT spawn error (spawnFn throws synchronously on BOTH attempts) retries once in v2 form, then reports unhealthy with the widened detail, never throws', async () => {
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

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(spawnFn).toHaveBeenNthCalledWith(1, 'gpiomon', ['gpiochip0', '4']);
    expect(spawnFn).toHaveBeenNthCalledWith(2, 'gpiomon', ['--chip', 'gpiochip0', '4']);
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: false });
    expect(statuses.at(-1)!.detail).toMatch(/gpiomon failed/i);
    expect(registry.markHealth).toHaveBeenCalledTimes(1);
    expect(registry.markHealth).toHaveBeenCalledWith(
      'gpio-1', false, expect.stringMatching(/gpiomon failed/i),
    );
  });

  it("ENOENT spawn error (child emits 'error' asynchronously) triggers exactly one v2 (--chip) retry", async () => {
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
    // A single tick is enough: Node defers a setImmediate scheduled DURING a currently-
    // executing immediate callback to the NEXT loop iteration, so the v1 attempt's async
    // 'error' fires (and synchronously spawns the v2 retry) within this one await, while
    // the v2 retry's OWN async 'error' hasn't fired yet.
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(spawnFn).toHaveBeenNthCalledWith(2, 'gpiomon', ['--chip', 'gpiochip0', '4']);
    expect(registry.markHealth).not.toHaveBeenCalled(); // still pending -- the retry's own error hasn't fired
  });

  it('a killed child\'s late SIGTERM exit after stop() is not reported unhealthy '
    + '(fix-round-1 F1+F2: gpiomon killed by stop() reports code:null, signal:SIGTERM, not code:0)', async () => {
    const { spawnFn, children } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    await source.stop();
    children[0]!.emit('exit', null, 'SIGTERM');

    expect(registry.markHealth).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
  });

  it('an unexpected exit code 0 on the v1 attempt triggers the v2 retry rather than an immediate report '
    + '(fix-round-1 F1+F2: any self-exit before stop() is a dead process, code 0 included; final-review I3: '
    + 'but now owes one retry before that verdict is final)', async () => {
    const { spawnFn, children, calls } = fakeSpawn();
    const source = new GpioMotionSource({
      sources: [{ id: 'gpio-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 }],
      registry: registry as unknown as MotionSourceRegistry,
      bus,
      spawnFn: spawnFn as never,
    });
    await source.start();
    children[0]!.emit('exit', 0, null);

    expect(registry.markHealth).not.toHaveBeenCalled(); // not yet -- one retry is still owed
    expect(calls).toEqual([
      ['gpiomon', ['gpiochip0', '4']],
      ['gpiomon', ['--chip', 'gpiochip0', '4']],
    ]);

    children[1]!.emit('exit', 0, null); // the v2 retry ALSO exits unexpectedly
    expect(statuses.at(-1)).toMatchObject({ source: 'motion_gpio', healthy: false });
    expect(registry.markHealth).toHaveBeenCalledTimes(1);
    expect(registry.markHealth).toHaveBeenCalledWith('gpio-1', false, expect.any(String));
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
