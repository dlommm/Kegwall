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

/** The exact actionable detail `source_status`/`registry.markHealth` report once BOTH
 * spawn attempts for a source have failed (final-review I3: see `startOne`'s
 * `spawnAttempt` below for the v1 → v2 `--chip` retry that has to fail twice before this
 * ever fires) -- deliberately
 * one fixed string (with stderr appended when gpiomon produced any) rather than a
 * different message per failure mode, since the fix an admin needs to make is the same
 * regardless of which particular way "gpiomon isn't usable here" manifested. Widened from
 * the pre-I3 wording (which only ever said "gpiomon not found") to cover the OTHER half
 * of the retry: a libgpiod version mismatch, where the binary IS found but rejects the
 * arg syntax the other major version uses. */
const UNHEALTHY_DETAIL = 'gpiomon failed — install libgpiod (v1 or v2) and map /dev/gpiochip0 into the container';

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

  // Fix-round-1 review finding (F1+F2): `stop()` sets this FIRST, before killing any
  // child, and EVERY child event handler below (stdout data, stderr data, 'error',
  // 'exit') checks it before doing anything -- a killed child can still fire late/
  // buffered events (a queued stdout flush, an 'exit' for the SIGTERM `kill()` itself)
  // well after `stop()` returns, and none of those late events may report health,
  // trigger a wake, or otherwise touch state for an instance that's no longer live.
  // Without this, every ordinary restart (`registerConfiguredSources` rebuild via
  // `restartSourcesIfLive`) risked a spurious unhealthy report from the OLD, just-killed
  // child racing the NEW instance's own status.
  private stopped = false;

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
    // Same "reset the stopped flag on (re)start" idiom as `motionMqtt.ts`'s
    // `MotionMqttSource.start()` -- defensive, since in practice every instance is
    // start()-ed exactly once (`manager.ts` constructs a fresh instance per
    // `registerConfiguredSources` rebuild rather than reusing a stopped one).
    this.stopped = false;
    for (const source of this.sources) this.startOne(source);
  }

  async stop(): Promise<void> {
    // Set BEFORE killing anything -- see the field's doc comment above for why this
    // ordering matters (a killed child's late events must see `stopped: true`).
    this.stopped = true;
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

  /**
   * Spawns gpiomon for one configured source, with ONE retry (final-review I3) before
   * ever reporting unhealthy: `gpiomon`'s CLI arg syntax changed between libgpiod v1
   * (`gpiomon <chip> <line>`, positional) and v2 (`gpiomon --chip <chip> <line>`) — a
   * host running the "wrong" major version for whichever form is tried first fails
   * immediately with a misleading detail that looks like "not found" when the binary is
   * actually right there. The first unexpected exit/error for a source's CURRENT attempt
   * (whichever form it used) gets exactly one respawn in the OTHER form before this
   * source is finally reported unhealthy — `retried` (shared across both attempts, via
   * this closure) is what caps it at one, and `finalReported` (also shared) is what
   * guards the eventual healthy/unhealthy verdict to at most once total, mirroring
   * fix-round-1's single-attempt `reported` gate one level up.
   */
  private startOne(source: GpioMotionSourceOptions['sources'][number]): void {
    let retried = false;
    let finalReported = false;
    // Which verdict `finalReported` delivered — a HEALTHY verdict must still be
    // revocable when the child later dies (see onAttemptFailed), whereas an
    // UNHEALTHY one is terminal for this source until the next rebuild.
    let reportedHealthy = false;

    const reportHealthyOnce = (): void => {
      if (this.stopped || finalReported) return;
      finalReported = true;
      reportedHealthy = true;
      this.reportHealthy(source.id);
    };

    const spawnAttempt = (isRetry: boolean): void => {
      if (this.stopped) return; // I3: never spawn into a torn-down source (also what
                                 // makes "stop() lands during the retry window" a no-op).
      let stderrText = '';
      // `attemptDone` gates THIS attempt's own failure path so an ENOENT 'error' event
      // immediately followed by an 'exit' for the SAME dead child triggers at most one
      // retry/report decision — the same "reported once" idiom fix-round-1 used, now
      // scoped per attempt rather than per source (there are up to two attempts now).
      let attemptDone = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const onAttemptFailed = (): void => {
        if (attemptDone) return;
        attemptDone = true;
        clearTimeout(graceTimer);
        if (this.stopped) return;
        if (finalReported) {
          // The verdict for this source was already delivered. If it was HEALTHY and the
          // child has now died on its own (OOM-kill, USB GPIO expander reset, libgpiod
          // error hours later), swallowing this exit would leave the dashboard claiming
          // "gpiomon running" forever while motion is actually dead — the same
          // claims-healthy-forever failure class the UDP source's silence reporting
          // fixed. Report unhealthy (with an accurate detail — UNHEALTHY_DETAIL's
          // "install libgpiod" advice is wrong for a process that WAS running) so the
          // operator sees it; the next settings-driven source rebuild respawns it. An
          // already-UNHEALTHY source is terminal — a late duplicate event for the same
          // dead child changes nothing.
          if (reportedHealthy) {
            reportedHealthy = false;
            const trimmed = stderrText.trim();
            const detail = trimmed
              ? `gpiomon exited unexpectedly after running healthy; stderr: ${trimmed}`
              : 'gpiomon exited unexpectedly after running healthy — motion is down until sources restart';
            this.bus.emit('source_status', { source: 'motion_gpio', healthy: false, detail, ts: new Date().toISOString() });
            this.registry.markHealth(source.id, false, detail);
          }
          return;
        }
        if (!isRetry && !retried) {
          // The FIRST attempt's first failure, whichever event reported it — retry once,
          // in the other libgpiod arg form, before giving up on this source.
          retried = true;
          spawnAttempt(true);
          return;
        }
        // Either this WAS the retry, or (defensively) a retry was somehow already spent —
        // both attempts are now exhausted, so this is the final, widened-detail verdict.
        finalReported = true;
        this.reportUnhealthy(source.id, stderrText);
      };

      const args = isRetry
        ? ['--chip', source.chip, String(source.line)] // libgpiod v2 form
        : [source.chip, String(source.line)]; // libgpiod v1 form (tried first)
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnFn('gpiomon', args);
      } catch (err) {
        // A synchronous throw out of spawnFn itself (the fake test seam can do this; real
        // Node `spawn()` normally reports ENOENT via the async 'error' event below instead)
        // -- still must not propagate out of start().
        stderrText = err instanceof Error ? err.message : String(err);
        onAttemptFailed();
        return;
      }
      this.children.push(child);

      graceTimer = setTimeout(reportHealthyOnce, HEALTHY_GRACE_MS);
      // Never let this timer alone keep the process (or a test's fake-timer runner) alive.
      graceTimer.unref?.();

      child.stdout.on('data', (chunk: Buffer | string) => {
        if (this.stopped) return; // a killed child's buffered stdout flushing late must
                                   // not trigger a debounced wake.
        reportHealthyOnce(); // any output at all proves gpiomon is attached and streaming.
        for (const rawLine of chunk.toString().split('\n')) {
          const line = rawLine.trim();
          if (line) this.handleLine(source, line);
        }
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        if (this.stopped) return;
        stderrText += chunk.toString();
      });

      // Real Node's ENOENT-style spawn failure surfaces here, asynchronously, rather than
      // as a synchronous throw -- see the try/catch above for the (test-only) other case.
      child.on('error', () => {
        if (this.stopped) return;
        onAttemptFailed();
      });

      // Fix-round-1 review finding (F1+F2): a gpiomon process that exits ON ITS OWN, for
      // ANY reason -- code 0, non-zero, or killed by a signal -- is unexpected and
      // unhealthy, full stop, as long as `stop()` hasn't been called yet: a well-behaved
      // gpiomon runs forever watching the line until killed, so there's no such thing as
      // "gpiomon finished successfully" while this source is still meant to be live. The
      // PREVIOUS `code === 0` special case was wrong in the other direction too: `kill()`
      // (SIGTERM, from `stop()` above) typically surfaces here as `code: null, signal:
      // 'SIGTERM'`, not `code: 0` -- so that check neither protected the real stop() path
      // NOR correctly distinguished it from a genuine failure. The `this.stopped` guard
      // (checked first, inside `onAttemptFailed`) is what actually distinguishes
      // "we killed it on purpose" from "it died on its own" now.
      child.on('exit', () => {
        if (this.stopped) return;
        onAttemptFailed();
      });
    };

    spawnAttempt(false);
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
   * said about why. Only the LAST (i.e. retry) attempt's stderr is captured here (I3) --
   * `startOne`'s `stderrText` resets per attempt, so a v1-syntax attempt's own
   * "unrecognized option"-style noise never pollutes the v2 retry's actual failure
   * reason, which is the one that matters once both have failed. */
  private reportUnhealthy(id: string, stderrText: string): void {
    const trimmed = stderrText.trim();
    const detail = trimmed ? `${UNHEALTHY_DETAIL}; stderr: ${trimmed}` : UNHEALTHY_DETAIL;
    this.bus.emit('source_status', { source: 'motion_gpio', healthy: false, detail, ts: new Date().toISOString() });
    this.registry.markHealth(id, false, detail);
  }
}
