import type { Role, User } from '../../server/db/users.js';
// From core/automationSchema.ts, a dependency-free (zod only) module by the same
// deliberate design as core/lookupTypes.ts/core/wallConfig.ts above — see that file's own
// top doc comment. `AutomationRuleInput`/`AutomationRule` are safe VALUE-free type
// imports here.
import type { AutomationRuleInput, AutomationRule } from '../../server/core/automationSchema.js';
// From db/notificationsRepo.ts — a plain db module (only value import is core/errors.ts,
// itself dependency-free), same "types via type-only server imports" precedent as
// `Settings`/`Pour`/etc. above.
import type { Notification } from '../../server/db/notificationsRepo.js';
// From db/settings.ts, a plain db module with no Fastify-specific imports of its own (its
// only value import, core/errors.ts, is dependency-free) — safe to type-import here the
// same way db/beers.ts, db/taps.ts, etc. already are (see core/lookupTypes.ts's doc
// comment above for the routes-file case this is NOT: that one drags in Fastify request/
// reply augmentations that don't typecheck in tsconfig.web.json's program).
import type { Settings } from '../../server/db/settings.js';
import type { Pour, Keg, KegStatus } from '../../server/db/kegs.js';
import type { Tap } from '../../server/db/taps.js';
import type { Monitor } from '../../server/db/monitors.js';
import type { ActivityEvent } from '../../server/db/activity.js';
import type { SourceStatus } from '../../server/ingest/manager.js';
import type { Beer, BeerInput } from '../../server/db/beers.js';
import type { TelemetryPoint } from '../../server/db/telemetry.js';
import type {
  PoursByDay, HourHistogram, KegBurnStat, BeerVolumeStat, LeaderboardEntry,
} from '../../server/db/stats.js';
// From core/wallConfig.ts, NOT routes/crud.ts — same "type-only import of a routes file
// drags in its Fastify-augmenting value imports" issue documented above for
// core/lookupTypes.ts. wallConfig.ts has no imports beyond zod, so it's a safe
// dependency-free type source for the `Wall` interface below (`routes/crud.ts` types its
// own `config` field as `unknown`; the client-side type is stricter since every wall
// PATCH already validates against this exact schema — see `web/lib/wallEditorConfig.ts`).
import type { WallConfig } from '../../server/core/wallConfig.js';
// From core/lookupTypes.ts, NOT routes/lookup.ts — see that core module's doc comment:
// a type-only import of a ROUTES file would drag its Fastify-request-augmenting value
// imports into this (web) tsconfig's program, where they don't typecheck.
import type { BreweryLookupResult } from '../../server/core/lookupTypes.js';

/**
 * The authed variant of `./api.ts`'s typed-result fetch pattern (see that file's doc
 * comments — same shape, same "never throw, always return a typed result" contract).
 * The one behavioral difference: any 401 response redirects the browser to
 * `/admin/login`, UNLESS the current page IS `/admin/login` or `/admin/setup` — those
 * two pages call authed endpoints themselves (a bad login attempt 401s; the setup
 * probe on both pages calls `getMe`-adjacent endpoints before a session exists) and
 * need to render their own in-place error state instead of bouncing away from
 * themselves. This is the ONE place in the admin SPA that owns "session died/missing
 * -> back to login"; every later admin page (Tasks 3-9) is expected to build its own
 * authed API calls on top of `request` below rather than reimplementing this.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  /** HTTP status code, or 0 when the request never reached the server (network error). */
  status: number;
  message: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const LOGIN_PATH = '/admin/login';
const SETUP_PATH = '/admin/setup';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function onAuthPage(): boolean {
  const { pathname } = window.location;
  return pathname === LOGIN_PATH || pathname === SETUP_PATH;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // Explicit even though same-origin is fetch's spec default — this call always
      // needs the session cookie, so the intent shouldn't rely on an implicit default.
      credentials: 'same-origin',
      // A FormData body (Task 4's uploadLabel) must NOT get a 'Content-Type:
      // application/json' header — the browser sets its own 'multipart/form-data;
      // boundary=...' for FormData, and stamping application/json over it would break
      // the upload server-side.
      //
      // Phase 5 Task 7 fix: a BODYLESS request (every caller that passes no `body` at
      // all — logout, ack, run-now, every DELETE, etc.) must ALSO not get the JSON
      // content-type header. Fastify's default JSON body parser rejects an empty body
      // when `Content-Type: application/json` is set at all
      // (`FST_ERR_CTP_EMPTY_JSON_BODY`, statusCode 400) — this app's generic error
      // handler doesn't recognize that Fastify-native error class and was mapping it to
      // an opaque 500, so EVERY bodyless POST/DELETE call in the admin UI was silently
      // broken against a real server (caught by a real Playwright/Chromium round trip —
      // see the Task 7 e2e notification-ack test and adminApi.test.ts's own regression
      // test; every other test here mocks `fetch` itself, so none of them ever exercised
      // real server body-parsing behavior). A request with no body has no content to
      // declare a type for in the first place, so this is also just correct HTTP.
      headers: {
        ...(init?.body !== undefined && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message = isRecord(body) && typeof body.message === 'string'
      ? body.message
      : res.statusText || `Request failed with status ${res.status}`;
    if (res.status === 401 && !onAuthPage()) {
      window.location.assign(LOGIN_PATH);
    }
    return { ok: false, status: res.status, message };
  }

  return { ok: true, data: body as T };
}

export function needsSetup(): Promise<ApiResult<{ needsSetup: boolean }>> {
  return request('/api/auth/needs-setup');
}

export function getMe(): Promise<ApiResult<User>> {
  return request('/api/auth/me');
}

export function login(username: string, password: string): Promise<ApiResult<User>> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<ApiResult<{ ok: boolean }>> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function setup(input: {
  username: string; displayName: string; password: string;
}): Promise<ApiResult<User>> {
  return request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Task 3: dashboard home ---

/** GET /api/admin/activity — the dashboard's activity feed (viewer role). */
export function getActivity(): Promise<ApiResult<ActivityEvent[]>> {
  return request('/api/admin/activity');
}

/** GET /api/sources — per-source health, feeding the dashboard's source health card. */
export function getSources(): Promise<ApiResult<SourceStatus[]>> {
  return request('/api/sources');
}

/** GET /api/pours?since=... — used by the dashboard to total up today's pours (count +
 * volume). `2000` is the endpoint's own max `limit`, high enough that a single busy day
 * of pours is never silently truncated. */
export function getPoursSince(sinceIso: string): Promise<ApiResult<Pour[]>> {
  return request(`/api/pours?since=${encodeURIComponent(sinceIso)}&limit=2000`);
}

// --- Phase 5 Task 0: admin pours management (reassign/unclaim + per-tap default drinker) ---

/** GET /api/pours?limit=100 — the pours admin page's "recent 100" table (viewer role for
 * the read; reassign/unclaim below is what's editor-gated). Newest first (see
 * `listPours`, db/pours.ts). */
export function listRecentPours(): Promise<ApiResult<Pour[]>> {
  return request('/api/pours?limit=100');
}

/** PATCH /api/pours/:id/drinker — editor-role admin reassign/unclaim (`drinkerId: null`
 * unclaims). Unlike the public claim flow, this always overrides any existing claim —
 * see routes/crud.ts's doc comment on the route. */
export function setPourDrinker(pourId: number, drinkerId: number | null): Promise<ApiResult<Pour>> {
  return request(`/api/pours/${pourId}/drinker`, { method: 'PATCH', body: JSON.stringify({ drinkerId }) });
}

// --- Task 4: beers + lookup services ---

export function listBeers(): Promise<ApiResult<Beer[]>> {
  return request('/api/beers');
}

export function createBeer(input: BeerInput): Promise<ApiResult<Beer>> {
  return request('/api/beers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateBeer(id: number, input: Partial<BeerInput>): Promise<ApiResult<Beer>> {
  return request(`/api/beers/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/beers/:id — 204 no-content on success; 409 (`ApiFailure`, `status: 409`)
 * when the beer is still referenced by a keg (see db/beers.ts's `deleteBeer`). */
export function deleteBeer(id: number): Promise<ApiResult<null>> {
  return request(`/api/beers/${id}`, { method: 'DELETE' });
}

/** GET /api/lookup/breweries?q= — the beers form's brewery autocomplete. An empty `q`
 * still round-trips cleanly (server returns `[]` without calling the upstream service). */
export function lookupBreweries(q: string): Promise<ApiResult<BreweryLookupResult[]>> {
  return request(`/api/lookup/breweries?q=${encodeURIComponent(q)}`);
}

/** POST /api/uploads/label — multipart file upload (Task 1); returns the stored
 * `/labels/...` path. Sends a real `FormData` body — see `request()`'s Content-Type
 * handling above for why that must NOT get a `application/json` header. */
export function uploadLabel(file: File): Promise<ApiResult<{ path: string }>> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/uploads/label', { method: 'POST', body: form });
}

// --- Task 5: taps & kegs (tap CRUD, swap wizard, on-deck queue) ---

export function listTaps(): Promise<ApiResult<Tap[]>> {
  return request('/api/taps');
}

export function createTap(
  input: { number: number; name?: string | null; defaultDrinkerId?: number | null },
): Promise<ApiResult<Tap>> {
  return request('/api/taps', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTap(
  id: number, input: { number?: number; name?: string | null; defaultDrinkerId?: number | null },
): Promise<ApiResult<Tap>> {
  return request(`/api/taps/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/taps/:id — 204 on success; 409 (`ApiFailure`) when the tap still has kegs
 * on record or a bound monitor (see db/taps.ts's `deleteTap`). */
export function deleteTap(id: number): Promise<ApiResult<null>> {
  return request(`/api/taps/${id}`, { method: 'DELETE' });
}

/** GET /api/kegs, optionally filtered by status. Used both for the swap wizard's
 * "defaults from the beer's last keg" lookup (no filter — any status) and the taps
 * page's kicked-history panel (`status: 'kicked'`, filtered down to one tap client-side
 * — see TapsPage/KickedHistory's doc comment for why that reuses this endpoint rather
 * than a new per-tap one). */
export function listKegs(params: { status?: KegStatus } = {}): Promise<ApiResult<Keg[]>> {
  const qs = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return request(`/api/kegs${qs}`);
}

/** POST /api/kegs — a bare create (`status` omitted) makes an `on_tap` keg directly on a
 * free tap; `status: 'on_deck'` (with `tapId` required) queues it behind the tap's
 * current keg instead — the on-deck queue's "add to queue" action. */
export function createKeg(input: {
  beerId: number; sizeMl: number; volStartMl: number;
  tapId?: number | null; status?: 'on_deck';
}): Promise<ApiResult<Keg>> {
  return request('/api/kegs', { method: 'POST', body: JSON.stringify(input) });
}

/** DELETE /api/kegs/:id — removes a queued on-deck keg from its tap's queue; 400 for any
 * keg that isn't currently on_deck (see db/kegs.ts's `removeOnDeckKeg`). */
export function removeOnDeckKeg(id: number): Promise<ApiResult<null>> {
  return request(`/api/kegs/${id}`, { method: 'DELETE' });
}

/** GET /api/taps/:id/on-deck — the swap wizard's on-deck queue for one tap, in queue order. */
export function listOnDeck(tapId: number): Promise<ApiResult<Keg[]>> {
  return request(`/api/taps/${tapId}/on-deck`);
}

/** POST /api/taps/:id/swap — either taps a brand-new keg (`beerId`/`sizeMl`/`volStartMl`)
 * or promotes an already-queued on-deck keg (`fromKegId`); either way, any currently
 * on_tap keg for this tap is kicked first (see db/kegs.ts's `swapKeg`). */
export function swapTap(
  tapId: number,
  input: { beerId: number; sizeMl: number; volStartMl: number } | { fromKegId: number },
): Promise<ApiResult<Keg>> {
  return request(`/api/taps/${tapId}/swap`, { method: 'POST', body: JSON.stringify(input) });
}

/** GET /api/monitors — sanitized (no device key) monitor list; the swap wizard uses this
 * to find a Kegtron Pro monitor bound to the tap being swapped (unlocks the "Import from
 * Kegtron" beer-pick option and the step 4 "Reset volume on device" action). */
export function listMonitors(): Promise<ApiResult<Monitor[]>> {
  return request('/api/monitors');
}

/** POST /api/kegtron/import/:monitorId — creates a beer from a bound Pro monitor's
 * current device config (Kegtron import, swap wizard step 2). */
export function importKegtronBeer(monitorId: number): Promise<ApiResult<Beer>> {
  return request(`/api/kegtron/import/${monitorId}`, { method: 'POST' });
}

/** POST /api/kegtron/reset-volume/:monitorId — zeroes the physical device's dispensed-
 * volume counter for a bound Pro monitor's port (swap wizard step 4, optional; also the
 * Monitors page's standalone reset action, Task 6). */
export function resetKegtronVolume(monitorId: number): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/kegtron/reset-volume/${monitorId}`, { method: 'POST', body: JSON.stringify({}) });
}

// --- Task 6: monitors page ---

/** POST /api/monitors/:id/bind — binds (a numeric `tapId`) or unbinds (`null`) a
 * discovered monitor; the response is the sanitized `Monitor` (no device key). */
export function bindMonitor(id: number, tapId: number | null): Promise<ApiResult<Monitor>> {
  return request(`/api/monitors/${id}/bind`, { method: 'POST', body: JSON.stringify({ tapId }) });
}

/** GET /api/monitors/:id/telemetry?hours= — a Kegtron Pro monitor's recent temp/humidity
 * readings (viewer role), feeding the Monitors page's per-device detail expand. `hours`
 * defaults to 24 server-side when omitted. */
export function getMonitorTelemetry(id: number, hours = 24): Promise<ApiResult<TelemetryPoint[]>> {
  return request(`/api/monitors/${id}/telemetry?hours=${hours}`);
}

/** POST /api/kegtron/wifi-rssi/:monitorId — a live Kegtron.GetWiFiRssi RPC round-trip
 * (editor role, matching every other kegtron.ts RPC bridge) for a bound Pro monitor's
 * WiFi signal strength in dBm; the Monitors page's Pro detail panel button (Phase 5 Task
 * 0). A 502 (device unreachable / mdash error) is the expected "gentle" failure mode —
 * same shape as `resetKegtronVolume` above. */
export function getMonitorWifiRssi(monitorId: number): Promise<ApiResult<{ rssi: number }>> {
  return request(`/api/kegtron/wifi-rssi/${monitorId}`, { method: 'POST' });
}

// --- Task 7: walls (list, editor, live preview) ---

export interface Wall { id: number; slug: string; name: string; config: WallConfig }

export function listWalls(): Promise<ApiResult<Wall[]>> {
  return request('/api/walls');
}

/** `config` is left `unknown` on the way IN (the caller — `WallEditor`'s save flow —
 * always runs it through `wallConfigSchema`/`parseWallConfigForm` first, see
 * `wallEditorConfig.ts`; re-typing it here would just duplicate that check with a
 * weaker one). Omitting `config` entirely lets the walls list's "Add wall" form create a
 * bare wall (server fills schema defaults — see `routes/crud.ts`'s `createWall`). */
export function createWall(input: { slug: string; name: string; config?: unknown }): Promise<ApiResult<Wall>> {
  return request('/api/walls', { method: 'POST', body: JSON.stringify(input) });
}

export function updateWall(
  id: number,
  input: { slug?: string; name?: string; config?: unknown },
): Promise<ApiResult<Wall>> {
  return request(`/api/walls/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/walls/:id — 204 on success; the wall's `/wall/:slug` URL stops resolving
 * immediately (no FK/conflict case today — nothing else references a wall row). */
export function deleteWall(id: number): Promise<ApiResult<null>> {
  return request(`/api/walls/${id}`, { method: 'DELETE' });
}

// --- Task 8: users, settings, backup ---

export function listUsers(): Promise<ApiResult<User[]>> {
  return request('/api/users');
}

/** POST /api/users for a real login account (username + password + role). The server
 * branches on `drinkerOnly` (see routes/crud.ts) — omitted here, unlike
 * `createDrinkerProfile` below, so this always takes the login-user path. */
export function createLoginUser(input: {
  username: string; displayName: string; password: string; role: Role;
}): Promise<ApiResult<User>> {
  return request('/api/users', { method: 'POST', body: JSON.stringify(input) });
}

/** POST /api/users for a drinker-only profile (no login, `role: null`) — the leaderboard/
 * claim-a-pour identity with no admin access. `drinkerOnly: true` is what routes the
 * server to `createDrinker` instead of `createUser` (see routes/crud.ts). */
export function createDrinkerProfile(input: {
  displayName: string; avatarColor?: string;
}): Promise<ApiResult<User>> {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ ...input, drinkerOnly: true }),
  });
}

/** PATCH /api/users/:id — edits a login user's display name/role/password (password
 * optional: omit to leave the hash untouched) or a drinker profile's display
 * name/avatar/`isDrinker` flag. 409 (`ApiFailure`) when demoting the last admin — see
 * db/users.ts's `updateUser`. */
export function updateUser(id: number, input: {
  displayName?: string; role?: Role; password?: string;
  avatarColor?: string | null; isDrinker?: boolean;
}): Promise<ApiResult<User>> {
  return request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/users/:id — 204 on success; 409 (`ApiFailure`, message "cannot delete the
 * last admin") when `id` is the sole remaining admin — see db/users.ts's `deleteUser`. */
export function deleteUser(id: number): Promise<ApiResult<null>> {
  return request(`/api/users/${id}`, { method: 'DELETE' });
}

/** GET /api/settings — secrets (kegtronApiKey, mqtt.password, alertChannels' per-channel
 * secrets) come back masked (see db/settings.ts's `masked()`); SettingsPage never PATCHes
 * one of these mask strings back — see `patchSettings` below. */
export function getSettings(): Promise<ApiResult<Settings>> {
  return request('/api/settings');
}

/** PATCH /api/settings — callers pass ONLY the keys that actually changed (the server
 * scopes writes to the literal top-level keys present on the request body — see
 * routes/crud.ts's `requestedKeys` — so an omitted key is left untouched, not reset to
 * its schema default). Returns the fresh masked settings on success. */
export function patchSettings(patch: Partial<Settings>): Promise<ApiResult<Settings>> {
  return request('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
}

/** POST /api/admin/restore — multipart upload of a full `app.db` snapshot (e.g. one
 * downloaded from this same install's own `GET /api/admin/backup`, or another install's)
 * to stage as `DATA_DIR/pending-restore.db`. Only takes effect on the NEXT server
 * restart — see db/db.ts's `applyPendingRestore` — this call alone changes nothing live. */
export function uploadRestore(file: File): Promise<ApiResult<{ ok: boolean; message: string }>> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/admin/restore', { method: 'POST', body: form });
}

// --- Task 9: stats ---

/** GET /api/stats/pours?days= — pour count + volume per day, zero-filled, feeding the
 * Stats page's pours/day bar chart. `days` is one of the range switcher's three values
 * (server 400s on anything else — see routes/stats.ts). */
export function getPoursByDay(days: 7 | 30 | 90): Promise<ApiResult<PoursByDay[]>> {
  return request(`/api/stats/pours?days=${days}`);
}

/** GET /api/stats/hours — pour count by the SERVER's local hour-of-day (see
 * `hourHistogram` in db/stats.ts) over the trailing 30 days, always all 24 hours. Feeds
 * the Stats page's hour-of-day bar row. */
export function getHourHistogram(): Promise<ApiResult<HourHistogram[]>> {
  return request('/api/stats/hours');
}

/** GET /api/stats/kegs — every currently-on_tap keg's level, remaining volume, trailing-
 * 7-day burn rate, and projected kick date. Feeds the Stats page's per-keg depletion
 * cards. */
export function getActiveKegStats(): Promise<ApiResult<KegBurnStat[]>> {
  return request('/api/stats/kegs');
}

/** GET /api/stats/beers?days= — total volume + pour count per beer over the trailing
 * `days` days, descending by volume. Feeds the Stats page's volume-by-beer bars. */
export function getBeersByVolume(days: 7 | 30 | 90): Promise<ApiResult<BeerVolumeStat[]>> {
  return request(`/api/stats/beers?days=${days}`);
}

/** GET /api/stats/temps?monitorId=&hours= — a Kegtron Pro monitor's recent temp/humidity
 * readings for the Stats page's temp line chart; `hours` defaults to 48 server-side when
 * omitted (a wider window than the Monitors page's own 24h detail panel — see
 * `getMonitorTelemetry` above — since the Stats page's chart is meant to show a real
 * multi-day trend, not just "what's it doing right now"). */
export function getStatsTemps(monitorId: number, hours = 48): Promise<ApiResult<TelemetryPoint[]>> {
  return request(`/api/stats/temps?monitorId=${monitorId}&hours=${hours}`);
}

/** GET /api/stats/leaderboard?window= — pour count + volume per drinker, claimed pours
 * only, descending by volume. Feeds the Stats page's leaderboard table. */
export function getLeaderboard(window: 'week' | 'month' | 'all'): Promise<ApiResult<LeaderboardEntry[]>> {
  return request(`/api/stats/leaderboard?window=${window}`);
}

// --- Task 6: automations, notification center, channel send-test ---

export function listAutomations(): Promise<ApiResult<AutomationRule[]>> {
  return request('/api/automations');
}

export function getAutomation(id: number): Promise<ApiResult<AutomationRule>> {
  return request(`/api/automations/${id}`);
}

/** POST /api/automations — `input` is run through `automationForm.ts`'s
 * `parseAutomationForm` (the REAL `AutomationRuleConfigSchema`, imported) client-side
 * BEFORE this is ever called, so a save can never reach the server with a shape it would
 * reject — see that module's doc comment for the round-trip story. */
export function createAutomation(input: AutomationRuleInput): Promise<ApiResult<AutomationRule>> {
  return request('/api/automations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAutomation(
  id: number, input: Partial<AutomationRuleInput>,
): Promise<ApiResult<AutomationRule>> {
  return request(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/automations/:id — 204 on success; the rule's history in `notifications` is
 * kept (`automation_id` nulled, not cascaded — see db/automations.ts's `deleteAutomation`). */
export function deleteAutomation(id: number): Promise<ApiResult<null>> {
  return request(`/api/automations/${id}`, { method: 'DELETE' });
}

export interface AutomationRunResult { type: string; ok: boolean; error?: string }

/** POST /api/automations/:id/run — the builder's "test run" button: dispatches every
 * action against a fabricated synthetic context (no cooldown/runaway/lastFiredAt
 * bookkeeping consumed — see `AutomationEngine.runRuleOnce`'s doc comment) and reports a
 * per-action result. */
export function runAutomation(id: number): Promise<ApiResult<{ results: AutomationRunResult[] }>> {
  return request(`/api/automations/${id}/run`, { method: 'POST' });
}

/** Rendering metadata for one of the 9 one-click alert templates — mirrors
 * `automation/templates.ts`'s `TemplateParamMeta`/the serialized subset of `AlertTemplate`
 * that `GET /api/automations/templates` actually sends (its own `build`/`paramsSchema`
 * are server-only and never serialize — see routes/automations.test.ts's own assertion of
 * that). Defined locally rather than type-imported from templates.ts: that module's own
 * `paramsSchema: z.ZodType<P>` field's generic would need to be typed `any` here anyway,
 * and this page never needs the server type, only the JSON shape the route returns. */
export interface AutomationTemplateSummary {
  id: string;
  label: string;
  description: string;
  params: { name: string; label: string; type: 'number' | 'string'; default?: number | string; min?: number; max?: number }[];
}

export function listAutomationTemplates(): Promise<ApiResult<AutomationTemplateSummary[]>> {
  return request('/api/automations/templates');
}

/** POST /api/automations/from-template — `params` omitted uses every param's own default
 * (see the template's `paramsSchema`). Some templates (temp/humidity out-of-range) create
 * TWO rules from one call — hence `automations: AutomationRule[]`, always an array. */
export function createFromTemplate(
  template: string, params?: Record<string, unknown>,
): Promise<ApiResult<{ automations: AutomationRule[] }>> {
  return request('/api/automations/from-template', {
    method: 'POST',
    body: JSON.stringify(params ? { template, params } : { template }),
  });
}

export interface AutomationChannelOption { name: string; label: string }

/** GET /api/automations/channels — the `notify` action's channel multi-select options:
 * `inApp` always, plus whichever `alertChannels` entries currently have config saved. Not
 * the same as `GET /api/settings` (admin-only; this is editor/viewer-safe — see
 * routes/automations.ts's doc comment on the route). */
export function listAutomationChannels(): Promise<ApiResult<AutomationChannelOption[]>> {
  return request('/api/automations/channels');
}

/** GET /api/notifications?limit=&before= — newest-first, `before` an exclusive `id`
 * cursor (see db/notificationsRepo.ts's `listNotifications`). Both params omitted by
 * default (server applies its own default `limit`). */
export function listNotifications(
  opts: { limit?: number; before?: number } = {},
): Promise<ApiResult<Notification[]>> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.before !== undefined) params.set('before', String(opts.before));
  const qs = params.toString();
  return request(`/api/notifications${qs ? `?${qs}` : ''}`);
}

export function getUnackedCount(): Promise<ApiResult<{ count: number }>> {
  return request('/api/notifications/unacked-count');
}

/** POST /api/notifications/:id/ack — viewer role (see routes/notifications.ts's doc
 * comment on why acking isn't gated above viewer). */
export function ackNotification(id: number): Promise<ApiResult<Notification>> {
  return request(`/api/notifications/${id}/ack`, { method: 'POST' });
}

export function ackAllNotifications(): Promise<ApiResult<{ count: number }>> {
  return request('/api/notifications/ack-all', { method: 'POST' });
}

/** POST /api/channels/:name/test — admin role. Always resolves `ok: true` at the HTTP
 * layer (200) even when the send itself failed — see routes/channels.ts's doc comment;
 * the caller reads `.data.ok`/`.data.message` for the actual send outcome. */
export function testChannel(name: string): Promise<ApiResult<{ ok: boolean; message?: string }>> {
  return request(`/api/channels/${name}/test`, { method: 'POST' });
}
