import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  createPresenceSource, deletePresenceSource, getPresenceSources, getSettings, listWalls,
  patchSettings, setPresenceState, updatePresenceSource, updateWall,
  type PresenceSourcesResponse, type Wall,
} from '../../lib/adminApi';
import { isDisplayPowerMessage, type PowerStage } from '../../lib/displayPower';
import { useTapStates } from '../../lib/useTapStates';
import { formatRelativeTime } from '../../lib/useRelativeTime';
import {
  configToFormState, parseWallConfigForm, safeParseWallConfig, type WallConfigFormState,
} from '../../lib/wallEditorConfig';
// From db/settings.ts, a plain db module with no Fastify-specific value imports of its own
// (see adminApi.ts's own doc comment on this exact "types via type-only server imports"
// precedent for `MotionSource`) — safe to type-import here for the Sources panel's
// add/edit modal, which needs `MatchRule` (adminApi.ts only re-exports `MotionSource`
// via `PresenceSourcesResponse`, not the nested match-rule union).
import type { MatchRule, MotionSource } from '../../../server/db/settings.js';

/** Same cadence as DashboardPage's source-health/activity poll — there's no push channel
 * for the SSE agent-connection counts `GET /api/presence/sources` reports (unlike zone
 * power state, which rides `display_power` WS frames below). */
const POLL_INTERVAL_MS = 60_000;

const POWER_STAGE_LABEL: Record<PowerStage, string> = {
  active: 'Active', screensaver: 'Screensaver', off: 'Off',
};

/** "no agent" / "1 agent connected" / "N agents connected" — the Zones panel's per-row
 * agent-count text (spec Part B, panel 1). */
function agentsLabel(count: number): string {
  if (count === 0) return 'no agent';
  return `${count} agent${count === 1 ? '' : 's'} connected`;
}

/** A display-power panel row's three editable fields — the same shape WallEditor's
 * `displayPower` fieldset writes (wallEditorConfig.ts's `WallConfigFormState`), pulled
 * out on its own so this page doesn't have to hold a full per-wall form-state object
 * for fields it never shows. */
interface DpFields {
  screensaverAfterMinutes: number | null;
  offAfterMinutes: number | null;
  cameraMotion: boolean;
}

function dpFieldsFromWall(wall: Wall): DpFields {
  const { displayPower } = safeParseWallConfig(wall.config);
  return {
    screensaverAfterMinutes: displayPower.screensaverAfterMinutes,
    offAfterMinutes: displayPower.offAfterMinutes,
    cameraMotion: displayPower.cameraMotion,
  };
}

/** How long a matching WS `motion` frame briefly marks a Sources-panel row via
 * `data-blink="true"` (spec Part B, panel 3: "a live blink when a source fires"). A plain
 * `setTimeout`, not CSS animation-end or `requestAnimationFrame` — the brief's own
 * "assert the attribute, not the animation" steer means this has to be advanceable by
 * `vi.advanceTimersByTime` under fake timers, which only `setTimeout`/`setInterval` are. */
const BLINK_MS = 2000;

const SOURCE_TYPE_LABEL: Record<MotionSource['type'], string> = {
  mqtt: 'MQTT', webhook: 'Webhook', gpio: 'GPIO', ble: 'BLE',
};

/** The WS frame ws.ts's `motion_detected` relay sends (Task 3) whenever ANY source fires
 * — `sourceId` is `null` for a legacy/anonymous webhook wake (no motionSources id
 * attached), a real registry id for a configured source, or the `camera:<wallSlug>`
 * sentinel for a tablet camera wake (core/motionSources.ts's `trigger()`). Only
 * `sourceId` is read here (to blink the matching row); `wallSlug`/`ts` aren't needed by
 * this page the way they are by the Zones panel's `display_power` frames. */
interface MotionMessage { type: 'motion'; sourceId: string | null }

function isMotionMessage(msg: unknown): msg is MotionMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: unknown; sourceId?: unknown };
  return m.type === 'motion' && (m.sourceId === null || typeof m.sourceId === 'string');
}

/**
 * Parses free text typed into the add/edit modal's mqtt json-match "equals" field
 * (`source-mqtt-json-equals`) into whatever primitive it actually looks like:
 * `'true'`/`'false'` become real booleans, a bare numeric string becomes a number,
 * anything else stays a string. This matters because `matchRuleSchema`'s `json` mode
 * (db/settings.ts) compares the parsed MQTT payload's field against `equals` with `===`
 * — a sensor publishing the real JSON boolean `{"occupancy": true}` would never match an
 * `equals: "true"` STRING, only the boolean `true`, so the raw text input has to be
 * upgraded to the type it's describing rather than sent through verbatim as a string.
 */
export function parseEqualsInput(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/** The Sources panel's combined table row shape: every configured `motionSources` entry
 * plus every derived camera row, given a single `id` so blink-matching (`isMotionMessage`
 * above) and `data-testid="source-row-<id>"` work identically for both — a camera row's
 * `id` is the SAME `camera:<wallSlug>` sentinel `core/motionSources.ts`'s registry uses to
 * key its own status map, so a WS `motion` frame from a camera wake blinks the right row
 * with no extra mapping. */
type SourceRow =
  | { id: string; kind: 'source'; source: MotionSource; status: PresenceSourcesResponse['sources'][number]['status'] }
  | { id: string; kind: 'camera'; wallSlug: string; enabled: boolean; lastTriggeredAt: string | null };

/** The add/edit modal's flat draft shape — one field set per source type, all present at
 * once (simpler than a discriminated union here since the modal just hides the fields the
 * current `type` doesn't use; see `buildSourceConfig` below for the per-type narrowing
 * back down to `MotionSource['config']` at save time). `id: null` means "creating"; a
 * present `id` means "editing that source" (`saveSource` branches on it). */
interface SourceFormState {
  id: string | null;
  name: string;
  type: MotionSource['type'];
  enabled: boolean;
  wallSlug: string; // '' = every wall (null on the wire)
  mqttTopic: string;
  mqttMatchMode: MatchRule['mode'];
  mqttJsonField: string;
  mqttJsonEquals: string; // raw text, run through parseEqualsInput at save time
  mqttExactValue: string;
  gpioLine: string; // raw text for a number input
  gpioActiveLow: boolean;
  bleMac: string;
}

function blankSourceForm(): SourceFormState {
  return {
    id: null, name: '', type: 'mqtt', enabled: true, wallSlug: '',
    mqttTopic: '', mqttMatchMode: 'any', mqttJsonField: '', mqttJsonEquals: '', mqttExactValue: '',
    gpioLine: '', gpioActiveLow: false, bleMac: '',
  };
}

function sourceFormFrom(source: MotionSource): SourceFormState {
  const match = source.config.match;
  return {
    id: source.id, name: source.name, type: source.type, enabled: source.enabled,
    wallSlug: source.wallSlug ?? '',
    mqttTopic: source.config.topic ?? '',
    mqttMatchMode: match?.mode ?? 'any',
    mqttJsonField: match?.mode === 'json' ? match.field : '',
    mqttJsonEquals: match?.mode === 'json' ? String(match.equals) : '',
    mqttExactValue: match?.mode === 'exact' ? match.value : '',
    gpioLine: source.config.line !== undefined ? String(source.config.line) : '',
    gpioActiveLow: source.config.activeLow ?? false,
    bleMac: source.config.mac ?? '',
  };
}

/** Narrows the modal's flat draft back down to the per-type `config` shape
 * `motionSourceSchema` (db/settings.ts) expects — only the fields the CURRENT `type`
 * actually uses are sent, so switching the type select never leaks a stale sibling
 * type's fields (e.g. a leftover `topic` on a source just switched to `gpio`) into the
 * saved config. */
function buildSourceConfig(form: SourceFormState): MotionSource['config'] {
  if (form.type === 'mqtt') {
    const match: MatchRule = form.mqttMatchMode === 'json'
      ? { mode: 'json', field: form.mqttJsonField, equals: parseEqualsInput(form.mqttJsonEquals) }
      : form.mqttMatchMode === 'exact'
        ? { mode: 'exact', value: form.mqttExactValue }
        : { mode: 'any' };
    return { topic: form.mqttTopic, match };
  }
  if (form.type === 'gpio') {
    return { line: Number(form.gpioLine), activeLow: form.gpioActiveLow };
  }
  if (form.type === 'ble') {
    return { mac: form.bleMac.trim() || null };
  }
  return {}; // webhook: identity comes from the URL (?source=<id>), no config fields
}

/**
 * The name to actually save when the admin leaves the Name field blank: falls back to
 * the type's own natural identifier (mqtt's topic, gpio's line) rather than forcing a
 * redundant re-typing of information already entered elsewhere in the same form — the
 * SAME precedent `core/motionSources.ts`'s `migrateMotionTopics` already uses for a
 * legacy mqtt entry (`name: t.topic`, no separate name ever existed for those). `ble`/
 * `webhook` have no comparably natural identifier (a MAC is optional and identity-by-URL
 * has no field at all), so those fall through to `''` — genuinely nameless, which
 * `validateSourceForm` below rejects.
 */
function effectiveSourceName(form: SourceFormState): string {
  const typed = form.name.trim();
  if (typed !== '') return typed;
  if (form.type === 'mqtt') return form.mqttTopic.trim();
  if (form.type === 'gpio' && form.gpioLine.trim() !== '') return `GPIO line ${form.gpioLine.trim()}`;
  if (form.type === 'ble') return form.bleMac.trim();
  return '';
}

/**
 * Client-side pre-flight validation for the add/edit modal (review fix F3) — mirrors
 * SourcesGroup's "check before calling the api, set the form's error, return" idiom
 * (SettingsPage.tsx's `handleSubmit`, `mqttDirty && !mqttUrl.trim()`) rather than firing a
 * doomed `createPresenceSource`/`updatePresenceSource` call the server would 400 on
 * anyway (`motionSourceSchema`'s own per-type `superRefine` requirements, db/settings.ts:
 * mqtt needs `config.topic`+`config.match`, gpio needs `config.line`). Returns a human
 * message on failure, `null` when the form is good to submit. A name is always required
 * in the end (checked LAST, against `effectiveSourceName` — the typed value or its
 * type-appropriate fallback — not the raw field, so leaving Name blank while a topic/
 * line is already filled in isn't a redundant second error); `wallSlug`/`enabled`/the
 * non-required per-type fields (e.g. ble's `mac`) are all genuinely optional, so they're
 * left unchecked.
 */
function validateSourceForm(form: SourceFormState): string | null {
  if (form.type === 'mqtt') {
    if (form.mqttTopic.trim() === '') return 'An MQTT topic is required.';
    if (form.mqttMatchMode === 'json' && form.mqttJsonField.trim() === '') {
      return 'A JSON field is required for the "JSON field equals" match mode.';
    }
  }
  if (form.type === 'gpio') {
    const line = Number(form.gpioLine);
    if (form.gpioLine.trim() === '' || Number.isNaN(line) || line < 0) {
      return 'A GPIO line number (0 or greater) is required.';
    }
  }
  if (effectiveSourceName(form) === '') return 'A name is required.';
  return null;
}

/** The HA `rest_command` + automation YAML template, parameterized by whichever webhook
 * URL it should point at (review fix F2) — shared by the per-source Sources-table
 * snippet (`ha-snippet-<id>`, attributed via that source's own `&source=<id>` URL) and
 * the Webhook & agent panel's fallback (`ha-snippet`, the unattributed base URL, shown
 * only while no webhook-type source exists yet — see this component's doc comment on
 * why the unattributed URL is a fallback, not the promoted path). */
function haSnippetYaml(url: string): string {
  return `rest_command:
  kegwall_motion:
    url: "${url}"
    method: POST

automation:
  - alias: "Kegwall motion wake"
    trigger:
      - platform: state
        entity_id: binary_sensor.your_motion_sensor
        to: "on"
    action:
      - service: rest_command.kegwall_motion`;
}

/**
 * `/admin/presence` — the Displays & Presence hub (spec 2026-08-01, Part B), all four
 * panels:
 *
 *  1. Zones — one row per wall: live power state (seeded 'active' from the walls fetch,
 *     then kept current by `display_power` WS frames — both the on-connect replay and
 *     live transitions ride the same frame shape, so no special-casing is needed), a
 *     live agent-connection count, and Wake/Sleep/"Wake all" buttons that POST
 *     `/api/presence/state` (admin override, independent of any motion wake).
 *  2. Display power — per-wall `screensaverAfterMinutes`/`offAfterMinutes`/`cameraMotion`,
 *     writing the exact same `WallConfig.displayPower` shape the wall editor writes (same
 *     blank-input-means-null semantics, same real `wallConfigSchema` validation via
 *     `wallEditorConfig.ts` — see `saveDisplayPower` below).
 *  3. Motion sources — every configured `motionSources` entry (registry snapshot) plus
 *     every derived tablet-camera row, in one table: health dot, "last motion N min ago"
 *     (or "never"), and a live blink (`data-blink="true"` for `BLINK_MS`) on a matching WS
 *     `motion` frame. An add/edit modal switches its visible field set by `type` and
 *     validates client-side before ever calling the api (`validateSourceForm`); a camera
 *     row has no modal (it's derived from wall config, not a stored entry) — just a toggle
 *     that writes straight through to that wall's `displayPower.cameraMotion`, same field
 *     the Display power panel's `dp-camera-<slug>` checkbox edits (two doors to the same
 *     value, matching the spec's own "both doors stay" call for that field). Delete goes
 *     through an `.admin-confirm` confirmation dialog (same shell WallsPage/TapsPage/
 *     BeersPage use), per the spec's explicit "delete with confirm". A webhook-type row
 *     shows its own attributed copy-paste URL AND its own HA snippet
 *     (`ha-snippet-<id>`, `&source=<id>` baked in) in an expandable `<details>`.
 *  4. Webhook & agent — the presence webhook token's masked display + Generate button
 *     (MOVED here from SettingsPage's Integrations card, not duplicated — see
 *     SettingsPage.tsx's now-pointer-only `PresenceBlock`), the base copy-paste webhook
 *     URL, and a FALLBACK HA snippet (`ha-snippet`, unattributed base URL) shown only
 *     while there isn't yet a webhook-type source to attribute to — once one exists, its
 *     own row's `ha-snippet-<id>` above is the promoted path (per-source health/last-
 *     motion attribution an unattributed URL can't give an HA integrator).
 *
 * Live frames ride the SAME public `/ws` feed every other admin page's live data uses
 * (see DashboardPage.tsx's `useTapStates` for the precedent) — `useTapStates([], ...)`
 * opens that socket purely for its `onMessage` escape hatch; the taps/stale/connected
 * fields it also returns aren't needed here and are ignored.
 */
export function PresencePage() {
  const [walls, setWalls] = useState<Wall[]>([]);
  const [wallsLoaded, setWallsLoaded] = useState(false);
  const [zoneStates, setZoneStates] = useState<Record<string, PowerStage>>({});
  const [agentsBySlug, setAgentsBySlug] = useState<Record<string, number>>({});
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [dpForm, setDpForm] = useState<Record<number, DpFields>>({});
  const [dpErrors, setDpErrors] = useState<Record<number, string[] | null>>({});

  // --- Task 5: motion sources -----------------------------------------------------------
  const [sources, setSources] = useState<PresenceSourcesResponse['sources']>([]);
  const [cameraRows, setCameraRows] = useState<PresenceSourcesResponse['camera']>([]);
  const [blinking, setBlinking] = useState<Record<string, boolean>>({});
  // Per-row blink-clear timers, keyed by the SAME `id` as `blinking` — a ref (not state)
  // since these are pure bookkeeping for `setTimeout`/`clearTimeout` and never rendered.
  const blinkTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [sourceForm, setSourceForm] = useState<SourceFormState | null>(null);
  const [sourceFormSubmitting, setSourceFormSubmitting] = useState(false);
  const [sourceFormError, setSourceFormError] = useState<string | null>(null);
  const [sourcesActionError, setSourcesActionError] = useState<string | null>(null);
  // Review fix F1: delete goes through a confirm dialog (same `.admin-confirm` shell as
  // WallsPage's `deleteState` — see that page's doc comment for the pattern this mirrors)
  // instead of firing straight from the row button.
  const [deleteState, setDeleteState] = useState<{ id: string; name: string; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Task 5: webhook & agent panel -----------------------------------------------------
  // `webhookToken` is whatever `GET`/`PATCH /api/settings` last returned — ALWAYS the
  // masked '••••'+last4 display form (`presenceWebhookToken` ∈ SECRET_KEYS, db/settings.ts's
  // `SettingsStore.masked()`), used only for the "Webhook token" field's own display.
  // `freshToken` (final-review C1) is the SEPARATE, real raw value this tab put in hand
  // itself via `crypto.randomUUID()` the moment `handleGenerateToken` PATCHes it — the
  // server never echoes a real secret back, so this is the ONLY way this page can ever
  // know a real, copy-paste-able token; it's `null` on every fresh page load (including
  // right after a real token was generated in a DIFFERENT tab/session) until this tab's
  // own Generate button is clicked.
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWalls().then((result) => {
      if (cancelled || !result.ok) return;
      setWalls(result.data);
      setWallsLoaded(true);
      // Seed only slugs not already known — a `display_power` frame (including the
      // socket's own on-connect replay) can resolve before this fetch does, and that
      // live-known state must win over the 'active' default, never be clobbered by it.
      setZoneStates((prev) => {
        const next = { ...prev };
        for (const wall of result.data) {
          if (!(wall.slug in next)) next[wall.slug] = 'active';
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getPresenceSources().then((result) => {
        if (cancelled || !result.ok) return;
        const next: Record<string, number> = {};
        for (const agent of result.data.agents) next[agent.wall] = agent.connections;
        setAgentsBySlug(next);
        // Task 5: the SAME response's sources/camera arrays feed the Sources panel — one
        // poll, three pieces of state, rather than a second fetch of an endpoint that
        // already returns everything this page needs.
        setSources(result.data.sources);
        setCameraRows(result.data.camera);
      });
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Task 5: the presence webhook token (Webhook & agent panel) — fetched once on mount,
  // same masked value `GET /api/settings` always returns (see db/settings.ts's
  // `SettingsStore.masked()`); `handleGenerateToken` below refreshes it after a Generate.
  useEffect(() => {
    let cancelled = false;
    getSettings().then((result) => {
      if (!cancelled && result.ok) setWebhookToken(result.data.presenceWebhookToken);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Blink timers are plain `setTimeout`s tracked in a ref (see `blinkTimers` above) —
  // clear every pending one on unmount so a fake-timer-free real browser session never
  // fires a `setBlinking` call against an unmounted page.
  useEffect(() => () => {
    for (const timer of blinkTimers.current.values()) clearTimeout(timer);
  }, []);

  /** Re-fetches sources/camera/agents immediately after a create/update/delete/toggle —
   * the CRUD handlers below all call this rather than waiting for the next
   * `POLL_INTERVAL_MS` tick, so the table reflects a just-saved change right away. */
  function refreshSources() {
    getPresenceSources().then((result) => {
      if (!result.ok) return;
      const next: Record<string, number> = {};
      for (const agent of result.data.agents) next[agent.wall] = agent.connections;
      setAgentsBySlug(next);
      setSources(result.data.sources);
      setCameraRows(result.data.camera);
    });
  }

  /** Marks `id` as blinking (`data-blink="true"`) for `BLINK_MS`, restarting the clock if
   * it's already blinking (a second motion frame while the first blink is still fading
   * extends it, rather than the two timers racing to clear it early). */
  function blinkSource(id: string) {
    setBlinking((prev) => ({ ...prev, [id]: true }));
    const existing = blinkTimers.current.get(id);
    if (existing) clearTimeout(existing);
    blinkTimers.current.set(id, setTimeout(() => {
      setBlinking((prev) => ({ ...prev, [id]: false }));
      blinkTimers.current.delete(id);
    }, BLINK_MS));
  }

  const handleWsMessage = useCallback((msg: unknown) => {
    if (isDisplayPowerMessage(msg)) {
      setZoneStates((prev) => ({ ...prev, [msg.wallSlug]: msg.state }));
      return;
    }
    if (isMotionMessage(msg) && msg.sourceId) {
      blinkSource(msg.sourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `blinkSource` only closes
    // over stable setState setters + the `blinkTimers` ref (never a per-render value), so
    // it's safe to call from this `[]`-deps callback regardless of render vintage.
  }, []);
  useTapStates([], { onMessage: handleWsMessage });

  async function handleSetState(wall: string | undefined, state: PowerStage) {
    const result = await setPresenceState(wall, state);
    setZoneError(result.ok ? null : result.message);
  }

  function updateDpField<K extends keyof DpFields>(wall: Wall, key: K, value: DpFields[K]) {
    setDpForm((prev) => {
      const base = prev[wall.id] ?? dpFieldsFromWall(wall);
      return { ...prev, [wall.id]: { ...base, [key]: value } };
    });
  }

  async function saveDisplayPower(wall: Wall) {
    const fields = dpForm[wall.id] ?? dpFieldsFromWall(wall);
    const baseForm = configToFormState(safeParseWallConfig(wall.config));
    const form: WallConfigFormState = {
      ...baseForm,
      displayPowerScreensaverAfterMinutes: fields.screensaverAfterMinutes,
      displayPowerOffAfterMinutes: fields.offAfterMinutes,
      displayPowerCameraMotion: fields.cameraMotion,
    };
    // Every tapId already on the wall's own pages is by definition valid (it wouldn't be
    // there otherwise) -- passing them straight through as the "still valid" set means
    // `parseWallConfigForm`'s pruning step is a no-op here, without this panel needing to
    // fetch the full tap list just to reconstruct it (this panel never edits pages).
    const validTapIds = form.pages.flatMap((page) => page.tapIds);
    const parsed = parseWallConfigForm(form, validTapIds);
    if (!parsed.ok) {
      setDpErrors((prev) => ({ ...prev, [wall.id]: parsed.errors }));
      return;
    }
    setDpErrors((prev) => ({ ...prev, [wall.id]: null }));
    const result = await updateWall(wall.id, { config: parsed.config });
    if (!result.ok) {
      setDpErrors((prev) => ({ ...prev, [wall.id]: [result.message] }));
      return;
    }
    setWalls((prev) => prev.map((w) => (w.id === result.data.id ? result.data : w)));
  }

  // --- Task 5: motion-sources add/edit/delete --------------------------------------------

  function openAddSource() {
    setSourceFormError(null);
    setSourceForm(blankSourceForm());
  }

  function openEditSource(source: MotionSource) {
    setSourceFormError(null);
    setSourceForm(sourceFormFrom(source));
  }

  function closeSourceForm() {
    setSourceForm(null);
    setSourceFormError(null);
  }

  async function saveSource() {
    if (!sourceForm) return;
    const validationError = validateSourceForm(sourceForm);
    if (validationError) {
      setSourceFormError(validationError);
      return;
    }
    setSourceFormSubmitting(true);
    setSourceFormError(null);
    const body = {
      name: effectiveSourceName(sourceForm),
      type: sourceForm.type,
      enabled: sourceForm.enabled,
      wallSlug: sourceForm.wallSlug === '' ? null : sourceForm.wallSlug,
      config: buildSourceConfig(sourceForm),
    };
    const result = sourceForm.id
      ? await updatePresenceSource(sourceForm.id, body)
      : await createPresenceSource(body);
    setSourceFormSubmitting(false);
    if (!result.ok) {
      setSourceFormError(result.message);
      return;
    }
    setSourceForm(null);
    refreshSources();
  }

  /** Opens the delete confirm dialog (review fix F1) — the row's Delete button calls
   * this instead of deleting directly; only `handleConfirmDeleteSource` below actually
   * calls the api. */
  function requestDeleteSource(source: MotionSource) {
    setDeleteState({ id: source.id, name: source.name, error: null });
  }

  async function handleConfirmDeleteSource() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deletePresenceSource(deleteState.id);
    setDeleting(false);
    if (!result.ok) {
      setDeleteState({ ...deleteState, error: result.message });
      return;
    }
    setDeleteState(null);
    refreshSources();
  }

  /** The Sources panel's camera-row toggle — writes straight through to that wall's
   * `displayPower.cameraMotion` (the SAME field/write path the Display power panel's
   * `dp-camera-<slug>` checkbox edits via `saveDisplayPower`, just applied immediately
   * instead of staged behind that panel's own Save button — see this component's doc
   * comment for why both doors are intentional). A camera row only ever appears here
   * while its wall's `cameraMotion` is on (see routes/presence.ts's derivation), so this
   * toggle only ever needs to turn it OFF. */
  async function toggleCameraMotion(wallSlug: string, enabled: boolean) {
    const wall = walls.find((w) => w.slug === wallSlug);
    if (!wall) return;
    setSourcesActionError(null);
    const nextConfig = configToFormState(safeParseWallConfig(wall.config));
    nextConfig.displayPowerCameraMotion = enabled;
    const validTapIds = nextConfig.pages.flatMap((page) => page.tapIds);
    const parsed = parseWallConfigForm(nextConfig, validTapIds);
    if (!parsed.ok) {
      setSourcesActionError(parsed.errors.join(', '));
      return;
    }
    const result = await updateWall(wall.id, { config: parsed.config });
    if (!result.ok) {
      setSourcesActionError(result.message);
      return;
    }
    setWalls((prev) => prev.map((w) => (w.id === result.data.id ? result.data : w)));
    refreshSources();
  }

  // --- Task 5: webhook & agent panel -------------------------------------------------------

  /** Final-review C1: generates the token CLIENT-SIDE first (`crypto.randomUUID()`) so
   * the real value is in hand before the PATCH ever goes out — `patchSettings`'s response
   * is still used for the "Webhook token" masked DISPLAY field (that's the real,
   * server-confirmed masked form), but the raw value used to build working copy-paste
   * URLs comes from `freshToken`, set to the locally-generated UUID, never from the
   * response (which is masked, per `SettingsStore.masked()` — see this component's doc
   * comment on `freshToken` above). */
  async function handleGenerateToken() {
    setTokenError(null);
    setTokenSubmitting(true);
    const token = crypto.randomUUID();
    const result = await patchSettings({ presenceWebhookToken: token });
    setTokenSubmitting(false);
    if (!result.ok) {
      setTokenError(result.message);
      return;
    }
    setWebhookToken(result.data.presenceWebhookToken);
    setFreshToken(token);
  }

  /** Final-review C1/M7: shown in place of a real token in every copy-paste URL/snippet
   * below whenever `freshToken` is unknown — this tab has EITHER never generated a token
   * (so it only ever saw settings' masked '••••'+last4 form, if any token exists at all)
   * OR no token has ever been set. Interpolating the masked form (or an empty string,
   * M7's original bug) would either look plausible-but-401 or silently produce a bare
   * `token=` — a literal, obviously-not-real placeholder is honest about "you don't have
   * the real value to paste here yet" either way. */
  const TOKEN_PLACEHOLDER = '<token>';

  /** Whether every URL/snippet below can render a REAL, working token — false any time
   * this tab hasn't itself generated one this session (see `freshToken`'s doc comment). */
  const hasFreshToken = freshToken !== null;

  /** The full copy-paste webhook URL — `sourceId` omitted gives the generic base URL
   * (Webhook & agent panel), present gives that source's attributed URL (a `webhook`-type
   * row in the Sources table) so `POST`s to it stamp that specific source's
   * `lastTriggeredAt` (routes/presence.ts's `?source=` handling). Built by hand (not
   * `URLSearchParams`) specifically so the `freshToken === null` branch's
   * `TOKEN_PLACEHOLDER` renders as the literal text `<token>` rather than being
   * percent-encoded into `%3Ctoken%3E`. */
  function webhookUrl(sourceId?: string): string {
    // Narrows on `freshToken !== null` directly (not the `hasFreshToken` boolean above) so
    // TypeScript can actually see `freshToken` is a `string` on the `encodeURIComponent`
    // branch.
    const tokenPart = `token=${freshToken !== null ? encodeURIComponent(freshToken) : TOKEN_PLACEHOLDER}`;
    const sourcePart = sourceId ? `&source=${encodeURIComponent(sourceId)}` : '';
    return `${window.location.origin}/api/presence/motion?${tokenPart}${sourcePart}`;
  }

  const sourceRows: SourceRow[] = [
    ...sources.map((s): SourceRow => ({ id: s.source.id, kind: 'source', source: s.source, status: s.status })),
    ...cameraRows.map((c): SourceRow => ({ id: `camera:${c.wallSlug}`, kind: 'camera', ...c })),
  ];

  // Review fix F2: whether the panel-level fallback `ha-snippet` should render at all —
  // once a real webhook-type source exists, its own row's `ha-snippet-<id>` is the
  // promoted, attributed path.
  const hasWebhookSource = sources.some((s) => s.source.type === 'webhook');

  return (
    <div data-testid="presence-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Displays &amp; Presence</h1>
        <p className="admin-page-quiet">
          Zone power state, per-wall display-power timing, every configured motion
          source, and the webhook/agent setup that feeds them.
        </p>
      </header>

      <div className="presence-panels">
        <section className="dashboard-card presence-panel" data-testid="presence-panel-zones">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">ZONES</h2>
            <button type="button" data-testid="zone-wake-all" onClick={() => { void handleSetState(undefined, 'active'); }}>
              Wake all
            </button>
          </div>
          {zoneError && <p className="admin-page-quiet" role="alert" data-testid="zone-error">{zoneError}</p>}
          {wallsLoaded && walls.length === 0 ? (
            <p className="admin-page-quiet" data-testid="zones-empty">No walls set up yet.</p>
          ) : (
            <table className="admin-table" data-testid="zones-table">
              <thead>
                <tr>
                  <th scope="col">Wall</th>
                  <th scope="col">State</th>
                  <th scope="col">Agents</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {walls.map((wall) => {
                  const state = zoneStates[wall.slug] ?? 'active';
                  const agents = agentsBySlug[wall.slug] ?? 0;
                  return (
                    <tr key={wall.slug} data-testid={`zone-row-${wall.slug}`}>
                      <td>{wall.name}</td>
                      <td className="font-tabular" data-testid={`zone-state-${wall.slug}`}>
                        {POWER_STAGE_LABEL[state]}
                      </td>
                      <td data-testid={`zone-agents-${wall.slug}`}>{agentsLabel(agents)}</td>
                      <td>
                        <button
                          type="button"
                          data-testid={`zone-wake-${wall.slug}`}
                          onClick={() => { void handleSetState(wall.slug, 'active'); }}
                        >
                          Wake
                        </button>
                        <button
                          type="button"
                          data-testid={`zone-sleep-${wall.slug}`}
                          onClick={() => { void handleSetState(wall.slug, 'off'); }}
                        >
                          Sleep
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashboard-card presence-panel" data-testid="presence-panel-display-power">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">DISPLAY POWER</h2>
          </div>
          {wallsLoaded && walls.length === 0 ? (
            <p className="admin-page-quiet" data-testid="display-power-empty">No walls set up yet.</p>
          ) : (
            <table className="admin-table" data-testid="display-power-table">
              <thead>
                <tr>
                  <th scope="col">Wall</th>
                  <th scope="col">Screensaver after (min)</th>
                  <th scope="col">Off after (min)</th>
                  <th scope="col">Camera motion</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {walls.map((wall) => {
                  const fields = dpForm[wall.id] ?? dpFieldsFromWall(wall);
                  const errors = dpErrors[wall.id];
                  return (
                    <tr key={wall.slug} data-testid={`dp-row-${wall.slug}`}>
                      <td>{wall.name}</td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          data-testid={`dp-saver-${wall.slug}`}
                          value={fields.screensaverAfterMinutes ?? ''}
                          onChange={(e) => updateDpField(
                            wall,
                            'screensaverAfterMinutes',
                            e.target.value === '' ? null : Number(e.target.value),
                          )}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={2}
                          data-testid={`dp-off-${wall.slug}`}
                          value={fields.offAfterMinutes ?? ''}
                          onChange={(e) => updateDpField(
                            wall,
                            'offAfterMinutes',
                            e.target.value === '' ? null : Number(e.target.value),
                          )}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          data-testid={`dp-camera-${wall.slug}`}
                          checked={fields.cameraMotion}
                          onChange={(e) => updateDpField(wall, 'cameraMotion', e.target.checked)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          data-testid={`dp-save-${wall.slug}`}
                          onClick={() => { void saveDisplayPower(wall); }}
                        >
                          Save
                        </button>
                        {errors && (
                          <ul className="wall-editor__errors" role="alert" data-testid={`dp-errors-${wall.slug}`}>
                            {errors.map((err) => <li key={err}>{err}</li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashboard-card presence-panel" data-testid="presence-panel-sources">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">MOTION SOURCES</h2>
            <button type="button" data-testid="source-add" onClick={openAddSource}>
              Add source
            </button>
          </div>
          {sourcesActionError && (
            <p className="admin-page-quiet" role="alert" data-testid="sources-error">{sourcesActionError}</p>
          )}
          {sourceRows.length === 0 ? (
            <p className="admin-page-quiet" data-testid="sources-empty">No motion sources configured yet.</p>
          ) : (
            <table className="admin-table" data-testid="sources-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Wall</th>
                  <th scope="col">Health</th>
                  <th scope="col">Last motion</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((row) => {
                  const lastTriggeredAt = row.kind === 'source' ? row.status.lastTriggeredAt : row.lastTriggeredAt;
                  const healthy = row.kind === 'source' ? row.status.healthy : true;
                  const wallName = row.kind === 'source'
                    ? (row.source.wallSlug
                      ? (walls.find((w) => w.slug === row.source.wallSlug)?.name ?? row.source.wallSlug)
                      : 'All walls')
                    : (walls.find((w) => w.slug === row.wallSlug)?.name ?? row.wallSlug);
                  // Final-review C2: a disabled source stays LISTED (this row comes from
                  // `snapshotAll()`, not the enabled-only `snapshot()`) — `data-enabled`
                  // lets the row render dimmed while its Edit button (the only re-enable
                  // path — the modal's own `source-enabled` checkbox) still works exactly
                  // like any other row's. A camera row has no `enabled` field of its own
                  // here (it's simply absent from `cameraRows` once its wall's
                  // `displayPower.cameraMotion` is off — see routes/presence.ts's
                  // derivation), so it's always rendered non-dimmed.
                  const enabled = row.kind === 'source' ? row.source.enabled : true;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        data-testid={`source-row-${row.id}`}
                        data-blink={blinking[row.id] ? 'true' : 'false'}
                        data-enabled={String(enabled)}
                      >
                        <td>{row.kind === 'source' ? row.source.name : `Tablet camera — ${wallName}`}</td>
                        <td>{row.kind === 'source' ? SOURCE_TYPE_LABEL[row.source.type] : 'Camera'}</td>
                        <td>{wallName}</td>
                        <td>
                          <span
                            className={`dashboard-source-badge dashboard-source-badge--${healthy ? 'healthy' : 'unhealthy'}`}
                            data-testid={`source-health-${row.id}`}
                            data-healthy={String(healthy)}
                          >
                            {healthy ? '● OK' : '● Down'}
                          </span>
                        </td>
                        <td className="font-tabular" data-testid={`source-last-${row.id}`}>
                          {lastTriggeredAt ? formatRelativeTime(lastTriggeredAt) : 'Never'}
                        </td>
                        <td>
                          {row.kind === 'source' ? (
                            <>
                              <button type="button" data-testid={`source-edit-${row.id}`} onClick={() => openEditSource(row.source)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                data-testid={`source-delete-${row.id}`}
                                onClick={() => requestDeleteSource(row.source)}
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            <label className="settings-toggle">
                              <input
                                type="checkbox"
                                data-testid={`source-camera-toggle-${row.wallSlug}`}
                                checked={row.enabled}
                                onChange={(e) => { void toggleCameraMotion(row.wallSlug, e.target.checked); }}
                              />
                              <span>Enabled</span>
                            </label>
                          )}
                        </td>
                      </tr>
                      {row.kind === 'source' && row.source.type === 'webhook' && (
                        <tr>
                          <td colSpan={6}>
                            <code data-testid={`source-webhook-url-${row.id}`}>{webhookUrl(row.id)}</code>
                            {/* Final-review C1/M7: this row's URL renders unconditionally
                                (there's no `webhookToken`-gated wrapper the way the panel
                                below has), so it's the one place M7's "token= empty" bug
                                lived — `webhookUrl` now always falls back to the
                                `<token>` placeholder instead, gated the SAME way here. */}
                            {!hasFreshToken && (
                              <p className="admin-page-quiet" data-testid={`source-webhook-url-hint-${row.id}`}>
                                Regenerate the token to get copy-paste-ready URLs.
                              </p>
                            )}
                            <details className="presence-ha-snippet-details">
                              <summary>Home Assistant snippet</summary>
                              <pre className="presence-ha-snippet" data-testid={`ha-snippet-${row.id}`}>
                                {haSnippetYaml(webhookUrl(row.id))}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashboard-card presence-panel" data-testid="presence-panel-webhook">
          <div className="dashboard-card__head">
            <h2 className="dashboard-card__title font-display">WEBHOOK &amp; AGENT</h2>
          </div>
          <p className="admin-page-quiet">
            A shared token gates the external motion webhook and the presence-agent
            stream. Generate one, then point your motion sensor&rsquo;s automation (or a
            webhook source&rsquo;s own row above, for per-source attribution) at its URL.
          </p>
          <div className="admin-field masked-secret" data-testid="webhook-token-field">
            <span>Webhook token</span>
            <div className="masked-secret__row">
              <span className="masked-secret__value" data-testid="webhook-token-masked">
                {webhookToken || 'Not set'}
              </span>
              <button
                type="button"
                data-testid="webhook-token-generate"
                disabled={tokenSubmitting}
                onClick={() => { void handleGenerateToken(); }}
              >
                {tokenSubmitting ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
          {tokenError && (
            <p className="beer-form__notice" role="alert" data-testid="webhook-token-error">{tokenError}</p>
          )}
          {webhookToken ? (
            <>
              <p className="admin-page-quiet" data-testid="webhook-base-url">
                <code>{webhookUrl()}</code>
              </p>
              {/* Final-review C1: `webhookToken` being set only proves SOME token exists
                  (possibly only in its masked '••••'+last4 form, from a page load or a
                  PREVIOUS tab's Generate) — the URL above is only real/paste-ready when
                  THIS tab also has `freshToken` in hand. */}
              {!hasFreshToken && (
                <p className="admin-page-quiet" data-testid="webhook-url-hint">
                  Regenerate the token to get copy-paste-ready URLs.
                </p>
              )}
              {hasWebhookSource ? (
                <p className="admin-page-quiet">
                  See a webhook-type row in the Motion sources table above for its own
                  HA snippet, attributed to that source&rsquo;s health and last-motion time.
                </p>
              ) : (
                <>
                  <p className="admin-page-quiet">
                    No webhook-type source yet — this generic snippet works, but won&rsquo;t
                    give Home Assistant per-source health or last-motion attribution. Add a
                    webhook source above for that.
                  </p>
                  <pre className="presence-ha-snippet" data-testid="ha-snippet">
                    {haSnippetYaml(webhookUrl())}
                  </pre>
                </>
              )}
            </>
          ) : (
            <p className="admin-page-quiet">Generate a token to see your webhook URL and Home Assistant snippet.</p>
          )}
        </section>
      </div>

      {sourceForm && (
        <div
          className="user-form"
          data-testid="source-form"
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-form-title"
        >
          <h2 id="source-form-title" className="user-form__title font-display">
            {sourceForm.id ? 'Edit motion source' : 'Add motion source'}
          </h2>
          <div className="user-form__grid">
            <label className="admin-field">
              <span>Name</span>
              <input
                type="text"
                data-testid="source-name"
                value={sourceForm.name}
                onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
              />
            </label>
            <label className="admin-field">
              <span>Type</span>
              <select
                data-testid="source-type-select"
                value={sourceForm.type}
                onChange={(e) => setSourceForm({ ...sourceForm, type: e.target.value as MotionSource['type'] })}
              >
                <option value="mqtt">MQTT</option>
                <option value="webhook">Webhook</option>
                <option value="gpio">GPIO</option>
                <option value="ble">BLE</option>
              </select>
            </label>
            <label className="admin-field">
              <span>Wall</span>
              <select
                data-testid="source-wall-select"
                value={sourceForm.wallSlug}
                onChange={(e) => setSourceForm({ ...sourceForm, wallSlug: e.target.value })}
              >
                <option value="">All walls</option>
                {walls.map((w) => <option key={w.id} value={w.slug}>{w.name}</option>)}
              </select>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                data-testid="source-enabled"
                checked={sourceForm.enabled}
                onChange={(e) => setSourceForm({ ...sourceForm, enabled: e.target.checked })}
              />
              <span>Enabled</span>
            </label>
          </div>

          {sourceForm.type === 'mqtt' && (
            <div className="wall-editor__section">
              <h3 className="channels-group__block-title">MQTT</h3>
              <label className="admin-field">
                <span>Topic</span>
                <input
                  type="text"
                  data-testid="source-mqtt-topic"
                  value={sourceForm.mqttTopic}
                  onChange={(e) => setSourceForm({ ...sourceForm, mqttTopic: e.target.value })}
                />
              </label>
              <label className="admin-field">
                <span>Match mode</span>
                <select
                  data-testid="source-mqtt-match-mode"
                  value={sourceForm.mqttMatchMode}
                  onChange={(e) => setSourceForm({ ...sourceForm, mqttMatchMode: e.target.value as MatchRule['mode'] })}
                >
                  <option value="any">Any non-empty payload</option>
                  <option value="json">JSON field equals</option>
                  <option value="exact">Exact payload match</option>
                </select>
              </label>
              {sourceForm.mqttMatchMode === 'json' && (
                <>
                  <label className="admin-field">
                    <span>JSON field</span>
                    <input
                      type="text"
                      data-testid="source-mqtt-json-field"
                      value={sourceForm.mqttJsonField}
                      onChange={(e) => setSourceForm({ ...sourceForm, mqttJsonField: e.target.value })}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Equals</span>
                    <input
                      type="text"
                      data-testid="source-mqtt-json-equals"
                      value={sourceForm.mqttJsonEquals}
                      onChange={(e) => setSourceForm({ ...sourceForm, mqttJsonEquals: e.target.value })}
                    />
                  </label>
                </>
              )}
              {sourceForm.mqttMatchMode === 'exact' && (
                <label className="admin-field">
                  <span>Exact payload</span>
                  <input
                    type="text"
                    data-testid="source-mqtt-exact-value"
                    value={sourceForm.mqttExactValue}
                    onChange={(e) => setSourceForm({ ...sourceForm, mqttExactValue: e.target.value })}
                  />
                </label>
              )}
            </div>
          )}

          {sourceForm.type === 'gpio' && (
            <div className="wall-editor__section">
              <h3 className="channels-group__block-title">GPIO</h3>
              <label className="admin-field">
                <span>Line</span>
                <input
                  type="number"
                  min={0}
                  data-testid="source-gpio-line"
                  value={sourceForm.gpioLine}
                  onChange={(e) => setSourceForm({ ...sourceForm, gpioLine: e.target.value })}
                />
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  data-testid="source-gpio-active-low"
                  checked={sourceForm.gpioActiveLow}
                  onChange={(e) => setSourceForm({ ...sourceForm, gpioActiveLow: e.target.checked })}
                />
                <span>Active low</span>
              </label>
            </div>
          )}

          {sourceForm.type === 'ble' && (
            <div className="wall-editor__section">
              <h3 className="channels-group__block-title">BLE</h3>
              <label className="admin-field">
                <span>MAC address (blank = any BTHome motion sensor)</span>
                <input
                  type="text"
                  data-testid="source-ble-mac"
                  value={sourceForm.bleMac}
                  onChange={(e) => setSourceForm({ ...sourceForm, bleMac: e.target.value })}
                />
              </label>
            </div>
          )}

          {sourceForm.type === 'webhook' && (
            <p className="admin-page-quiet">
              Identity comes from the URL — save this source, then copy its row&rsquo;s
              webhook URL in the table above.
            </p>
          )}

          {sourceFormError && (
            <p className="beer-form__notice" role="alert" data-testid="source-form-error">{sourceFormError}</p>
          )}
          <div className="beer-form__actions">
            <button
              type="button"
              className="beer-form__submit"
              data-testid="source-save"
              disabled={sourceFormSubmitting}
              onClick={() => { void saveSource(); }}
            >
              {sourceFormSubmitting ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="beer-form__cancel" data-testid="source-cancel" onClick={closeSourceForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="source-delete-confirm-backdrop"
          onClick={() => !deleting && setDeleteState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="source-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="source-delete-title" className="font-display">Delete motion source</h3>
            <p>
              This will permanently delete &ldquo;{deleteState.name}&rdquo;. Any transport
              watching it (mqtt/gpio/ble) stops firing immediately. This can&rsquo;t be undone.
            </p>
            {deleteState.error && (
              <p role="alert" data-testid="source-delete-error">{deleteState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="source-delete-confirm"
                disabled={deleting}
                onClick={() => { void handleConfirmDeleteSource(); }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                data-testid="source-delete-cancel"
                disabled={deleting}
                onClick={() => setDeleteState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
