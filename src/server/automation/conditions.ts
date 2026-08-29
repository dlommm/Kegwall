import type { Condition } from '../core/automationSchema.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 3: pure, dependency-free (no db/bus) condition-matrix evaluation for the
// automation engine (`automation/engine.ts`). Kept standalone so every AND-ed condition
// branch is unit-testable without spinning up a bus/db/engine — see
// tests/automation/conditions.test.ts.
// ---------------------------------------------------------------------------

/** What a condition is evaluated against — the engine builds one of these per triggering
 * event (see `engine.ts`'s richer `EvalCtx`, which embeds this shape plus the
 * template-rendering context). Every field is independently nullable: not every trigger
 * resolves to a tap (`tapId`), a beer (`beerId`), or a value the `value_compare`
 * condition's `field` names. A condition that needs a field the event didn't supply
 * evaluates to `false` (documented per-condition below) — it can never THROW; a rule
 * with a condition that doesn't apply to its trigger just never matches, rather than
 * crashing the engine. */
export interface ConditionEvalCtx {
  tapId: number | null;
  beerId: number | null;
  levelPct: number | null;
  volumeMl: number | null;
  temp: number | null;
  /** ISO 8601 timestamp of the triggering event (or "now" for schedule/app_startup) —
   * `time_window`/`weekday` conditions read LOCAL time-of-day/weekday off this. */
  ts: string;
  /** `days_since_cleaned`'s input — OPTIONAL (unlike every other field above), because
   * unlike level%/temp/volume (which every event-derived ctx at least attempts to
   * resolve, even to `null`), this is only ever meaningful for the engine's per-monitor
   * `days_since_cleaned`-conditioned schedule check (see engine.ts's
   * `checkCleaningDueRule`) — every other ctx builder simply never sets it. Left
   * `undefined`, it behaves exactly like `null` ("not applicable" -> condition fails) —
   * see `evaluateCondition` below. Kept optional rather than required specifically so
   * this addition doesn't ripple through every existing `EvalCtx` builder/test fixture
   * that has no notion of "which monitor" to compute it for. */
  daysSinceCleaned?: number | null;
  /** `wall_scope`'s input (Task 8, presence/display-power framework) -- the triggering
   * event's wall slug, when it has one. Only the engine's `motion_detected`/
   * `display_power_changed` handlers ever set this (stamped from the bus event's own
   * `wallSlug`, `null` collapsed to `undefined` -- see engine.ts's `buildWallEvalCtx`);
   * every other ctx builder leaves it `undefined`, which `wall_scope` treats as "no wall
   * context" -> always false, same "inapplicable condition fails closed" rule every other
   * field here follows. */
  wallSlug?: string;
}

function timeOfDayMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** `"HH:MM"` -> minutes past local midnight. Exported for the engine's schedule
 * matching (engine.ts `checkScheduleRules`), which needs the same reading of a rule's
 * `trigger.time` this module gives `time_window`/quiet-hours boundaries. */
export function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Inclusive at `start`, exclusive at `end`. Handles an overnight window (`start > end`,
 * e.g. quiet hours `22:00`-`08:00`) by wrapping past midnight — shared by BOTH the
 * `time_window` condition and the engine's quiet-hours check (`settings.quietHours` has
 * the exact same `{start, end}` HH:MM shape), so the two features can never drift apart
 * on boundary semantics. */
export function isWithinTimeWindow(d: Date, start: string, end: string): boolean {
  const t = timeOfDayMinutes(d);
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s <= e) return t >= s && t < e;
  return t >= s || t < e;
}

/** True exactly on the transition from at-or-on-the-far-side of `threshold` to strictly
 * past it in `direction` — NOT true for every sample already past it (a keg that stays
 * below 15% for ten straight `volume_update` samples crosses exactly once). `direction:
 * 'below'`: `prev >= threshold && curr < threshold`. `'above'`: the mirror image. Shared
 * by the engine's `keg_level_crosses`/`temp_crosses` trigger matching AND its
 * auto-resolve check (which calls this with `opposite(direction)` against the SAME
 * prev/curr pair — see `opposite` below). */
export function crossed(prev: number, curr: number, threshold: number, direction: 'below' | 'above'): boolean {
  return direction === 'below' ? prev >= threshold && curr < threshold : prev <= threshold && curr > threshold;
}

export function opposite(direction: 'below' | 'above'): 'below' | 'above' {
  return direction === 'below' ? 'above' : 'below';
}

function valueFor(field: 'level_pct' | 'volume_ml' | 'temp', ctx: ConditionEvalCtx): number | null {
  switch (field) {
    case 'level_pct': return ctx.levelPct;
    case 'volume_ml': return ctx.volumeMl;
    case 'temp': return ctx.temp;
  }
}

function compare(value: number, op: 'lt' | 'lte' | 'gt' | 'gte', threshold: number): boolean {
  switch (op) {
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
  }
}

/** Evaluates a single condition. `lastFiredAt`/`now` back `min_interval` only — every
 * other condition type ignores them. Never throws: an inapplicable condition (e.g.
 * `tap_scope` against an event with no resolvable tap) evaluates to `false`, not an
 * error — a rule authored with a condition that doesn't fit its trigger simply never
 * fires, which is the correct "fails closed" behavior for an automation engine (a
 * silently-ignored condition would be far more surprising than a rule that never
 * matches).
 *
 * `tapIds`/`beerIds`/`days` empty arrays are treated as "no restriction" (matches
 * anything, including a `null` context) — the friendlier reading for a UI where these
 * lists start empty before an author picks anything, rather than "matches nothing".
 */
function evaluateCondition(
  c: Condition, ctx: ConditionEvalCtx, lastFiredAt: string | null, now: Date,
): boolean {
  switch (c.type) {
    case 'tap_scope':
      return c.tapIds.length === 0 || (ctx.tapId !== null && c.tapIds.includes(ctx.tapId));
    case 'beer_scope':
      return c.beerIds.length === 0 || (ctx.beerId !== null && c.beerIds.includes(ctx.beerId));
    case 'time_window':
      return isWithinTimeWindow(new Date(ctx.ts), c.start, c.end);
    case 'weekday':
      return c.days.length === 0 || c.days.includes(new Date(ctx.ts).getDay());
    case 'value_compare': {
      const value = valueFor(c.field, ctx);
      return value !== null && compare(value, c.op, c.value);
    }
    case 'min_interval': {
      if (!lastFiredAt) return true; // never fired -- nothing to be "too soon" after
      const elapsedMinutes = (now.getTime() - new Date(lastFiredAt).getTime()) / 60_000;
      return elapsedMinutes >= c.minutes;
    }
    case 'days_since_cleaned':
      return ctx.daysSinceCleaned != null && ctx.daysSinceCleaned >= c.days;
    case 'wall_scope':
      return ctx.wallSlug !== undefined && c.wallSlugs.includes(ctx.wallSlug);
  }
}

/** ANDs every condition in `conditions` (an empty list always matches — "no conditions"
 * means unconditional). Short-circuits on the first failure. */
export function evaluateConditions(
  conditions: Condition[], ctx: ConditionEvalCtx, lastFiredAt: string | null, now: Date,
): boolean {
  return conditions.every((c) => evaluateCondition(c, ctx, lastFiredAt, now));
}
