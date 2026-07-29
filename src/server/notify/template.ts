// ---------------------------------------------------------------------------
// Phase 5 Task 2: `{{path.to.value}}` templating for notify/webhook/mqtt action bodies
// (spec examples: `{{beer.name}}`, `{{tap.number}}`, `{{pour.volume_ml}}`,
// `{{keg.level_pct}}`). Deliberately the simplest possible implementation:
//   - NO code evaluation whatsoever (no `eval`, no `new Function`, no computed/dynamic
//     property access beyond a literal dot-separated path) -- a malicious/careless
//     automation body can never do more than read a value out of `ctx`.
//   - NO prototype-chain traversal -- every path segment is resolved via
//     `Object.prototype.hasOwnProperty.call`, so `{{beer.__proto__}}`,
//     `{{beer.constructor.name}}`, `{{beer.toString}}`, etc. all render as '' instead of
//     reaching into `Object.prototype` (whether or not anything has (mis)configured it).
//   - Any resolution failure (missing key at any depth, `null`/`undefined` leaf, a
//     non-object intermediate) degrades to '' -- never throws -- since a template body is
//     free-form user input rendered into a notification/webhook payload, and a typo'd
//     variable name should never crash a rule's actions.
// ---------------------------------------------------------------------------

/** The `{beer, tap, keg, pour, monitor, alert}` context shape every action template is
 * rendered against (Task 3's engine assembles this per trigger). Every field is optional
 * and independently `null`-able -- not every trigger has a `pour`, not every device has a
 * `monitor`, etc. -- `renderTemplate` treats an absent/null branch exactly like a missing
 * leaf (renders ''), never a crash. */
export interface TemplateContext {
  beer?: Record<string, unknown> | null;
  tap?: Record<string, unknown> | null;
  keg?: Record<string, unknown> | null;
  pour?: Record<string, unknown> | null;
  monitor?: Record<string, unknown> | null;
  alert?: Record<string, unknown> | null;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Resolves a dot-separated `path` against `ctx`, walking only OWN enumerable-or-not
 * properties at each step (`hasOwnProperty`, checked BEFORE the value is ever read, so a
 * getter on `Object.prototype` is never invoked) and never following the prototype chain.
 * Returns `undefined` the moment any segment is missing, `null`/`undefined`, or a
 * non-object -- the caller (`renderTemplate`) maps that uniformly to ''. */
function resolvePath(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Primitives render as their literal string form; everything else (objects, arrays,
 * functions -- none of which are legitimate leaf values for any documented template
 * variable) renders as '' rather than `[object Object]`/a JSON dump. */
function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Substitutes every `{{path.to.value}}` placeholder in `str` by resolving `path`
 * against `ctx` (see `resolvePath`/`stringifyValue` above). A placeholder whose path
 * cannot be resolved renders as '' -- there is no "leave it as-is" or "throw" mode. */
export function renderTemplate(str: string, ctx: TemplateContext): string {
  return str.replace(TOKEN_RE, (_match, path: string) => stringifyValue(resolvePath(ctx, path)));
}
