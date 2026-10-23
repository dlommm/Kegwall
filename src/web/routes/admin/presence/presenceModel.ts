import type { PresenceSourcesResponse, Wall } from '../../../lib/adminApi';
import type { PowerStage } from '../../../lib/displayPower';
import { safeParseWallConfig } from '../../../lib/wallEditorConfig';
import type { MatchRule, MotionSource } from '../../../../server/db/settings.js';

/**
 * The Presence page's plain logic (split out of PresencePage.tsx in Kegwall V2 M9): labels,
 * the motion-source form's draft shape and its validation, and the Home Assistant snippet.
 * No React here.
 */

/** Same cadence as Tonight's source-health poll: there's no push channel for the agent
 * connection counts `GET /api/presence/sources` reports (zone power rides `display_power`
 * WS frames instead). */
export const POLL_INTERVAL_MS = 60_000;

export const POWER_STAGE_LABEL: Record<PowerStage, string> = {
  active: 'Active', screensaver: 'Screensaver', off: 'Off',
};

/** "no agent" / "1 agent connected" / "N agents connected" — the Zones panel's per-row
 * agent-count text (spec Part B, panel 1). */
export function agentsLabel(count: number): string {
  if (count === 0) return 'no agent';
  return `${count} agent${count === 1 ? '' : 's'} connected`;
}

/** A display-power panel row's three editable fields — the same shape WallEditor's
 * `displayPower` fieldset writes (wallEditorConfig.ts's `WallConfigFormState`), pulled
 * out on its own so this page doesn't have to hold a full per-wall form-state object
 * for fields it never shows. */
export interface DpFields {
  screensaverAfterMinutes: number | null;
  offAfterMinutes: number | null;
  cameraMotion: boolean;
}

export function dpFieldsFromWall(wall: Wall): DpFields {
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
export const BLINK_MS = 2000;

export const SOURCE_TYPE_LABEL: Record<MotionSource['type'], string> = {
  mqtt: 'MQTT', webhook: 'Webhook', gpio: 'GPIO', ble: 'BLE',
};

/** The WS frame ws.ts's `motion_detected` relay sends (Task 3) whenever ANY source fires
 * — `sourceId` is `null` for a legacy/anonymous webhook wake (no motionSources id
 * attached), a real registry id for a configured source, or the `camera:<wallSlug>`
 * sentinel for a tablet camera wake (core/motionSources.ts's `trigger()`). Only
 * `sourceId` is read here (to blink the matching row); `wallSlug`/`ts` aren't needed by
 * this page the way they are by the Zones panel's `display_power` frames. */
export interface MotionMessage { type: 'motion'; sourceId: string | null }

export function isMotionMessage(msg: unknown): msg is MotionMessage {
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
export type SourceRow =
  | { id: string; kind: 'source'; source: MotionSource; status: PresenceSourcesResponse['sources'][number]['status'] }
  | { id: string; kind: 'camera'; wallSlug: string; enabled: boolean; lastTriggeredAt: string | null };

/** The add/edit modal's flat draft shape — one field set per source type, all present at
 * once (simpler than a discriminated union here since the modal just hides the fields the
 * current `type` doesn't use; see `buildSourceConfig` below for the per-type narrowing
 * back down to `MotionSource['config']` at save time). `id: null` means "creating"; a
 * present `id` means "editing that source" (`saveSource` branches on it). */
export interface SourceFormState {
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

export function blankSourceForm(): SourceFormState {
  return {
    id: null, name: '', type: 'mqtt', enabled: true, wallSlug: '',
    mqttTopic: '', mqttMatchMode: 'any', mqttJsonField: '', mqttJsonEquals: '', mqttExactValue: '',
    gpioLine: '', gpioActiveLow: false, bleMac: '',
  };
}

export function sourceFormFrom(source: MotionSource): SourceFormState {
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
export function buildSourceConfig(form: SourceFormState): MotionSource['config'] {
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
export function effectiveSourceName(form: SourceFormState): string {
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
export function validateSourceForm(form: SourceFormState): string | null {
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
export function haSnippetYaml(url: string): string {
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
