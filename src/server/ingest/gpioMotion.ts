import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventBus } from '../core/events.js';
import type { MotionSourceRegistry } from '../core/motionSources.js';
import type { Source } from './source.js';

// ---------------------------------------------------------------------------
// Displays & Presence hub Task 6: a `Source` (`motion_gpio`) that spawns one `gpiomon`
// (libgpiod CLI) child process per configured gpio-type `MotionSource` (Task 1's
// `ctx.motion.sources()`, resolved to fully-defaulted `chip`/`activeLow`/`debounceMs`
// values by `ingest/bootstrap.ts` -- see that file's doc comment for why the DEFAULTING
// happens there rather than in the schema: the schema (`db/settings.ts`) deliberately
// leaves those three fields bare-optional). ZERO new npm dependency -- `gpiomon` is an
// external CLI, spawned via `child_process.spawn`, same "shell out to a system tool"
// precedent as the installer scripts under `scripts/install/`.
//
// `spawnFn` is a test seam, same injected-override idiom as `motionMqtt.ts`'s `connectFn`
// (tests hand it a fake that returns an `EventEmitter` + `PassThrough` stdout/stderr
// instead of actually spawning a process).
// ---------------------------------------------------------------------------

/** A gpiomon child prints one line per edge event, in one of two libgpiod CLI formats
 * depending on the installed version:
 *  - v1: `event:  RISING EDGE offset: 4 timestamp: [1234.5]`
 *  - v2: `1234.567890 rising gpiochip0 4`
 * Both formats carry the edge direction as a bare case-insensitive `rising`/`falling`
 * word, so this deliberately does NOT try to fully parse either format -- a substring/
 * word-boundary match on whichever token appears is tolerant of both (and of any minor
 * spacing/field-order variation between libgpiod point releases). Anything without
 * either token (blank lines, gpiomon's own startup banner, `garbage`) is `null` --
 * callers skip those lines rather than erroring, since gpiomon's exact non-event output
 * isn't part of its stable CLI contract. */
export function parseGpiomonLine(line: string): 'rising' | 'falling' | null {
  if (/\brising\b/i.test(line)) return 'rising';
  if (/\bfalling\b/i.test(line)) return 'falling';
  return null;
}

/** The exact actionable detail `source_status`/`registry.markHealth` report for every
 * failure mode below (spawn error, non-zero exit) -- deliberately one fixed string (with
 * stderr appended when gpiomon produced any) rather than a different message per failure
 * mode, since the fix an admin needs to make is the same regardless of which particular
 * way "gpiomon isn't usable here" manifested. */
const UNHEALTHY_DETAIL = 'gpiomon not found — install libgpiod and map /dev/gpiochip0 into the container';

/** How long a gpiomon child runs with no output before being declared healthy anyway
 * (per-source `markHealth(id, true, ...)`) -- a PIR sensor that simply hasn't seen motion
 * yet must not read as "broken" forever. The first stdout line (any line, not just a
 * recognized edge) short-circuits this same "declared healthy" transition immediately,
 * since output at all proves gpiomon is attached to the chip and streaming. */
const HEALTHY_GRACE_MS = 3000;

export interface GpioMotionSourceOptions {
  /** One entry per configured gpio-type motion source, chip/activeLow/debounceMs
   * ALREADY resolved to their documented defaults by the caller (`ingest/bootstrap.ts`)
   * -- this class never applies a default itself, it only consumes fully-resolved
   * values, per the brief's interface contract. */
  sources: Array<{ id: string; chip: string; line: number; activeLow: boolean; debounceMs: number }>;
  /** Fires the actual wake + per-source `lastTriggeredAt`/health bookkeeping for a
   * debounced, edge-matched trigger -- see `core/motionSources.ts`'s `MotionSourceRegistry`. */
  registry: MotionSourceRegistry;
  bus: EventBus;
  /** Test-only override of `child_process.spawn` -- see header comment. */
  spawnFn?: typeof nodeSpawn;
}

export class GpioMotionSource implements Source {
  readonly name = 'motion_gpio' as const;

  private readonly sources: GpioMotionSourceOptions['sources'];
  private readonly registry: MotionSourceRegistry;
  private readonly bus: EventBus;
  private readonly spawnFn: typeof nodeSpawn;

  // Per-source last-triggered wall-clock ms, for the debounce window -- same
  // "in-memory only, keyed by source id" shape as `MotionSourceRegistry`'s own status
  // map, but this one is purely a debounce gate (never read back by anything else).
  private readonly lastTriggerAt = new Map<string, number>();
  private children: ChildProcessWithoutNullStreams[] = [];

  constructor(opts: GpioMotionSourceOptions) {
    this.sources = opts.sources;
    this.registry = opts.registry;
    this.bus = opts.bus;
    this.spawnFn = opts.spawnFn ?? nodeSpawn;
  }

  /** One gpiomon child per configured source, none of which can ever make `start()`
   * itself throw or reject -- a spawn failure for one source (missing binary, bad chip
   * name) reports THAT source unhealthy and leaves every other configured source
   * unaffected, same "source isolation" precedent as `manager.ts`'s `startAll()`. */
  async start(): Promise<void> {
    for (const source of this.sources) this.startOne(source);
  }

  async stop(): Promise<void> {
    for (const child of this.children) {
      try {
        child.kill();
      } catch {
        // best-effort -- a child that's already exited (or never actually started) has
        // nothing left to kill; stop() must never throw either, same as start().
      }
    }
    this.children = [];
  }

  private startOne(source: GpioMotionSourceOptions['sources'][number]): void {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn('gpiomon', [source.chip, String(source.line)]);
    } catch (err) {
      // A synchronous throw out of spawnFn itself (the fake test seam can do this; real
      // Node `spawn()` normally reports ENOENT via the async 'error' event below instead)
      // -- still must not propagate out of start().
      this.reportUnhealthy(source.id, err instanceof Error ? err.message : String(err));
      return;
    }
    this.children.push(child);

    let stderrText = '';
    let settled = false;
    const settleHealthy = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      this.reportHealthy(source.id);
    };
    const graceTimer = setTimeout(settleHealthy, HEALTHY_GRACE_MS);
    // Never let this timer alone keep the process (or a test's fake-timer runner) alive.
    graceTimer.unref?.();

    child.stdout.on('data', (chunk: Buffer | string) => {
      settleHealthy(); // any output at all proves gpiomon is attached and streaming.
      for (const rawLine of chunk.toString().split('\n')) {
        const line = rawLine.trim();
        if (line) this.handleLine(source, line);
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrText += chunk.toString();
    });

    // Real Node's ENOENT-style spawn failure surfaces here, asynchronously, rather than
    // as a synchronous throw -- see the try/catch above for the (test-only) other case.
    child.on('error', () => {
      settled = true;
      clearTimeout(graceTimer);
      this.reportUnhealthy(source.id, stderrText);
    });

    child.on('exit', (code) => {
      if (code === 0) return; // a clean exit after being stop()-killed is not a failure.
      settled = true;
      clearTimeout(graceTimer);
      this.reportUnhealthy(source.id, stderrText);
    });
  }

  private handleLine(source: GpioMotionSourceOptions['sources'][number], line: string): void {
    const edge = parseGpiomonLine(line);
    if (edge === null) return;
    // Motion edge is `rising` normally, `falling` when the sensor's output is
    // active-low (per-source, not global -- two sources can wire the same signal
    // convention differently).
    const motionEdge = source.activeLow ? 'falling' : 'rising';
    if (edge !== motionEdge) return;

    const now = Date.now();
    const last = this.lastTriggerAt.get(source.id) ?? 0;
    if (now - last < source.debounceMs) return; // within this source's own debounce window
    this.lastTriggerAt.set(source.id, now);
    this.registry.trigger(source.id);
  }

  /** Emits the aggregate `source_status` bus event AND mirrors it per-source via
   * `registry.markHealth` -- same two-audience pattern as `motionMqtt.ts`'s `emitStatus`
   * (the dashboard's aggregate Source Health row vs. the admin Sources page's per-row
   * health dot). */
  private reportHealthy(id: string): void {
    const detail = 'gpiomon running';
    this.bus.emit('source_status', { source: 'motion_gpio', healthy: true, detail, ts: new Date().toISOString() });
    this.registry.markHealth(id, true, detail);
  }

  /** `stderrText` -- whatever gpiomon wrote to its stderr stream before failing, if
   * anything -- is appended to the fixed actionable `UNHEALTHY_DETAIL` message per the
   * brief ("stderr captured into the unhealthy detail"), rather than replacing it, so the
   * admin always sees both the fix ("install libgpiod...") and whatever gpiomon itself
   * said about why. */
  private reportUnhealthy(id: string, stderrText: string): void {
    const trimmed = stderrText.trim();
    const detail = trimmed ? `${UNHEALTHY_DETAIL} (${trimmed})` : UNHEALTHY_DETAIL;
    this.bus.emit('source_status', { source: 'motion_gpio', healthy: false, detail, ts: new Date().toISOString() });
    this.registry.markHealth(id, false, detail);
  }
}
