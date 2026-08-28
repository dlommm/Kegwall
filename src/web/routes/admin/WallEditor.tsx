import { useEffect, useState, type FormEvent } from 'react';
import type { Tap } from '../../../server/db/taps.js';
import {
  listTaps, listMonitors, updateWall, getWallDevices, setWallDevices,
  type Wall, type WallDeviceRef,
} from '../../lib/adminApi';
import { groupMonitors, deviceLabel, type MonitorDeviceGroup } from '../../lib/monitorDevices';
import {
  configToFormState, parseWallConfigForm, safeParseWallConfig, WALL_TOKEN_KEYS,
  recommendedUiScale, type WallConfigFormState, type WallTokenKey,
} from '../../lib/wallEditorConfig';
import {
  FIELD_KEYS, TEMPLATE_DEFAULT_FIELDS, type CardTemplate, type FieldKey,
} from '../../lib/cardFields';
import type { WallConfig } from '../../../server/core/wallConfig.js';
import { THEMES, getTheme } from '../../themes/themes';
import { WallPagesBuilder } from './WallPagesBuilder';
import { WallLivePreview } from '../../components/WallLivePreview';

export interface WallEditorProps {
  wall: Wall;
  onBack: () => void;
  onSaved: (wall: Wall) => void;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

const CARD_TEMPLATES: { value: CardTemplate; label: string }[] = [
  { value: 'full', label: 'Full' },
  { value: 'standard', label: 'Standard' },
  { value: 'compact', label: 'Compact' },
  { value: 'minimal', label: 'Minimal' },
];

// Wall LOOK (Pour Wall overhaul): the layout template axis. 'classic' keeps the
// pre-overhaul WallGrid; the design-doc looks own their whole frame (see
// components/looks/). Card template/columns only apply to 'classic'.
const LOOKS: { value: WallConfig['look']; label: string }[] = [
  { value: 'classic', label: 'Classic grid' },
  { value: 'ledger', label: 'Ledger (rows)' },
  { value: 'gallery', label: 'Gallery (cards)' },
  { value: 'columns', label: 'Tap columns' },
  { value: 'chalkboard', label: 'Chalkboard' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'neon', label: 'Neon arcade' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'poster', label: 'Poster' },
  { value: 'departures', label: 'Departures' },
  { value: 'zen', label: 'Zen' },
];

const GLYPH_MODES: { value: WallConfig['glyphMode']; label: string }[] = [
  { value: 'flat', label: 'Flat fill' },
  { value: 'outline', label: 'Outline' },
  { value: 'duotone', label: 'Duotone' },
];

// Pour takeover styles (design 2a/2b/9a/9b/9c) — how the wall reacts to a live
// pour. Off preserves the pre-overhaul behavior (glow + badge only).
const TAKEOVER_STYLES: { value: WallConfig['takeover']['style']; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'full', label: 'Full screen' },
  { value: 'spotlight', label: 'Spotlight row' },
  { value: 'split', label: 'Split panel' },
  { value: 'dock', label: 'Bottom dock' },
  { value: 'fill', label: 'Screen fill' },
];

// Keg-asset fill indicator feature: doesn't apply to `compact` (its liquid swatch is too
// small for the keg cutaway art — see TapCard.tsx), but the setting itself is still a
// single per-wall toggle rather than per-template, so it's offered here unconditionally;
// an admin on `compact` just won't see it take visual effect until they switch templates.
const FILL_STYLES: { value: WallConfig['fillStyle']; label: string }[] = [
  { value: 'liquid', label: 'Beer-colored liquid' },
  { value: 'keg', label: 'Keg cutaway' },
];

// Live-preview size (per-user editing preference, persisted in localStorage — NOT wall config, so
// it never counts as a dirty edit and never ships to a TV). Drives a modifier class on the
// .wall-editor grid; the preview frame auto-scales to its pane, so a wider track = a bigger
// preview. 'stacked' is the biggest: one column, preview full-width on top.
type PreviewSize = 'm' | 'l' | 'xl' | 'stacked';
const PREVIEW_SIZE_KEY = 'kegwall:wallEditor:previewSize';
const PREVIEW_SIZES: { value: PreviewSize; label: string }[] = [
  { value: 'm', label: 'Compact' },
  { value: 'l', label: 'Large' },
  { value: 'xl', label: 'Max' },
  { value: 'stacked', label: 'Stacked' },
];
function loadPreviewSize(): PreviewSize {
  try {
    const v = localStorage.getItem(PREVIEW_SIZE_KEY);
    if (v === 'm' || v === 'l' || v === 'xl' || v === 'stacked') return v;
  } catch { /* localStorage unavailable (private mode / SSR) — fall through to default */ }
  return 'l'; // default bigger than the old 26rem cap: the preview was too small before
}

// Display fit (redesign 1c): the screen sizes offered + resolution options (with px sublabels).
const SCREEN_SIZES = [32, 43, 50, 55, 65, 75] as const;
const RESOLUTIONS: { value: WallConfig['display']['resolution']; label: string; px: string }[] = [
  { value: '720p', label: '720p', px: '1280×720' },
  { value: '1080p', label: '1080p', px: '1920×1080' },
  { value: '4k', label: '4K', px: '3840×2160' },
];

const FIELD_LABELS: Record<FieldKey, string> = {
  labelImage: 'Label image',
  brewery: 'Brewery',
  style: 'Style',
  description: 'Description',
  abv: 'ABV',
  ibu: 'IBU',
  lastPour: 'Last pour',
};

const TOKEN_LABELS: Record<WallTokenKey, string> = {
  '--bg': 'Background',
  '--surface': 'Surface',
  '--text': 'Text',
  '--text-dim': 'Dim text',
  '--accent': 'Accent',
  '--card-radius': 'Card radius',
};

/**
 * The wall editor (Task 7): every `WallConfig` field, plus name/slug, side-by-side with a
 * live `/wall/:slug` preview. Saving runs the form through `parseWallConfigForm` (the
 * REAL `wallConfigSchema`, imported — see wallEditorConfig.ts) before ever calling
 * `PATCH /api/walls/:id`; a validation failure blocks the request entirely and shows
 * friendly, field-naming messages instead. A successful save pushes live to any TV
 * already showing this wall (the server's PATCH handler broadcasts `state_changed`) —
 * this editor's own preview iframe is remounted at the same time so it never looks stale
 * relative to what was just saved.
 */
export function WallEditor({ wall, onBack, onSaved }: WallEditorProps) {
  const [currentWall, setCurrentWall] = useState(wall);
  const [name, setName] = useState(wall.name);
  const [slug, setSlug] = useState(wall.slug);
  const [form, setForm] = useState<WallConfigFormState>(() => configToFormState(safeParseWallConfig(wall.config)));
  const [taps, setTaps] = useState<Tap[]>([]);
  const [tapsStatus, setTapsStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [deviceGroups, setDeviceGroups] = useState<MonitorDeviceGroup[]>([]);
  const [selectedDeviceKeys, setSelectedDeviceKeys] = useState<Set<string>>(new Set());
  const [devicesStatus, setDevicesStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [errors, setErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  // Half-applied save tracking (non-atomic-save fix): true when the config PATCH
  // succeeded but the follow-up device-set PUT failed. Device selection alone never
  // counts as dirty (see the baseline DESIGN NOTE below), so without this flag the
  // Save button would disable after the config half saved and there'd be no way to
  // retry the failed device write.
  const [deviceSaveFailed, setDeviceSaveFailed] = useState(false);
  // Dirty tracking (redesign 1c): the toolbar's status + Save-to-TVs enablement compare the
  // live form/name/slug against a baseline captured at load and reset on each successful save.
  // DESIGN NOTE: device-selection-only changes aren't counted as dirty (kept simple — the
  // config, name and slug cover the vast majority of edits).
  const [baseline, setBaseline] = useState(() => JSON.stringify({
    form: configToFormState(safeParseWallConfig(wall.config)), name: wall.name, slug: wall.slug,
  }));
  // Dismissible first-time banner (redesign 1c).
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Settings search (redesign 1c): live-filters the section fieldsets by keyword.
  const [settingsQuery, setSettingsQuery] = useState('');
  // Pour simulation (redesign 1c): bumping this runs a simulated pour in the live preview.
  const [simulateNonce, setSimulateNonce] = useState(0);
  // Live-preview size (per-user; persisted). Default 'l' — the old fixed 26rem column was too small.
  const [previewSize, setPreviewSize] = useState<PreviewSize>(loadPreviewSize);
  useEffect(() => {
    try { localStorage.setItem(PREVIEW_SIZE_KEY, previewSize); } catch { /* ignore persistence failures */ }
  }, [previewSize]);

  useEffect(() => {
    let cancelled = false;
    listTaps().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTaps(result.data);
        setTapsStatus('loaded');
      } else {
        setTapsStatus('error');
      }
    });
    Promise.all([listMonitors(), getWallDevices(wall.id)]).then(([monitorsRes, devicesRes]) => {
      if (cancelled) return;
      if (monitorsRes.ok && devicesRes.ok) {
        // Govee sensors are monitors too now, but they measure rooms, not kegs —
        // never wall-assignable (wall_devices' CHECK is kegtron-only anyway).
        setDeviceGroups(groupMonitors(monitorsRes.data.filter((m) => m.type !== 'govee_sensor')));
        setSelectedDeviceKeys(new Set(devicesRes.data.map((d) => `${d.type}:${d.identifier}`)));
        setDevicesStatus('loaded');
      } else {
        setDevicesStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wall.id]);

  /** The tap pool this wall may draw from: taps bound to ports of the SELECTED devices
   * (strict — nothing selected means an empty pool and a wall that shows nothing). */
  const allowedTapIdSet = new Set(
    deviceGroups
      .filter((g) => selectedDeviceKeys.has(g.key))
      .flatMap((g) => g.ports.map((p) => p.tapId))
      .filter((id): id is number => id != null),
  );
  const allowedTaps = taps.filter((t) => allowedTapIdSet.has(t.id));

  function toggleDevice(key: string, checked: boolean) {
    setSelectedDeviceKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function updateField<K extends keyof WallConfigFormState>(key: K, value: WallConfigFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateFieldToggle(key: FieldKey, checked: boolean) {
    setForm((f) => ({ ...f, fields: { ...f.fields, [key]: checked } }));
  }

  /** Switching card template resets `form.fields` to the NEW template's defaults —
   * matching the theme-switch precedent (a theme switch doesn't carry the old theme's
   * resolved colors forward as overrides either). Without this, the serializer's always-
   * explicit 7-key `fields` map would silently ship the OLD template's toggles as
   * overrides on the new one — e.g. switching full -> minimal and saving would still
   * render like `full` on the live wall despite the admin picking `minimal`. Any manual
   * toggles the admin made were relative to the old template anyway, so discarding them
   * on a template switch is correct, not just convenient. */
  function updateCardTemplate(template: CardTemplate) {
    setForm((f) => ({ ...f, cardTemplate: template, fields: { ...TEMPLATE_DEFAULT_FIELDS[template] } }));
  }

  function updateTokenOverride(key: WallTokenKey, value: string) {
    setForm((f) => ({ ...f, themeOverrides: { ...f.themeOverrides, [key]: value } }));
  }

  // Display fit (redesign 1c): picking a screen size or resolution snaps the UI scale to the
  // recommended value; the operator then nudges the slider from there.
  function updateDisplaySize(sizeIn: number) {
    setForm((f) => ({ ...f, displaySizeIn: sizeIn, displayUiScale: recommendedUiScale(sizeIn, f.displayResolution) }));
  }
  function updateDisplayResolution(resolution: WallConfig['display']['resolution']) {
    setForm((f) => ({ ...f, displayResolution: resolution, displayUiScale: recommendedUiScale(f.displaySizeIn, resolution) }));
  }
  function resetUiScale() {
    setForm((f) => ({ ...f, displayUiScale: recommendedUiScale(f.displaySizeIn, f.displayResolution) }));
  }

  const activeTheme = getTheme(form.themeId);

  // Live preview (redesign 1c): render the DRAFT config directly — no save round-trip. An
  // in-progress invalid edit falls back to the last saved config so the preview never crashes.
  const draftParsed = parseWallConfigForm(form, allowedTaps.map((t) => t.id));
  const previewConfig = draftParsed.ok ? draftParsed.config : safeParseWallConfig(currentWall.config);
  const previewResPx = RESOLUTIONS.find((r) => r.value === form.displayResolution)?.px ?? '';

  // Live settings filter: a section shows when the query is empty or matches any of its keywords.
  const q = settingsQuery.trim().toLowerCase();
  const matchesQuery = (...keywords: string[]) => q === '' || keywords.some((k) => k.toLowerCase().includes(q));

  const dirty = JSON.stringify({ form, name, slug }) !== baseline;
  const statusText = dirty
    ? 'Unsaved changes — TVs unaffected'
    : deviceSaveFailed
      ? 'Config saved — device assignment not saved'
      : (savedNotice ? 'Saved · pushed live to your screens' : 'In sync with live wall');

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSavedNotice(false);

    if (!name.trim()) {
      setErrors(['Name is required.']);
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setErrors(['Slug must be lowercase letters, numbers, and hyphens only.']);
      return;
    }

    // Only taps within the selected devices' pool stay valid — the parser's existing
    // prune drops page tapIds that fell out of scope when a device was unchecked.
    const validTapIds = allowedTaps.map((t) => t.id);
    const parsed = parseWallConfigForm(form, validTapIds);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }

    setErrors(null);
    setSaving(true);
    const deviceRefs: WallDeviceRef[] = deviceGroups
      .filter((g) => selectedDeviceKeys.has(g.key) && g.type !== 'govee_sensor')
      .map((g) => ({ type: g.type as WallDeviceRef['type'], identifier: g.identifier }));
    // Write ORDER (non-atomic-save fix): the config PATCH runs FIRST, the device-set
    // PUT second. The PATCH is the validation-prone write (slug conflicts 409,
    // wallConfigSchema 400s server-side), while the PUT only fails on an unknown
    // device or a network drop -- and the server's PATCH handler validates `config`
    // purely against wallConfigSchema (routes/crud.ts), never cross-checking page
    // tapIds against the wall's *currently stored* device set, so patching the config
    // before the devices is safe. With the old (devices-first) order, a failed PATCH
    // left the device set already replaced -- live TVs re-scoped via the walls_changed
    // broadcast -- while the editor showed a generic error and a dirty state claiming
    // nothing had saved.
    const result = await updateWall(currentWall.id, {
      name: name.trim(), slug, config: parsed.config,
    });
    if (!result.ok) {
      // Nothing was written at all -- the device PUT never ran, so the plain message
      // and the untouched dirty state are both accurate here.
      setSaving(false);
      setErrors([result.message]);
      return;
    }
    const devicesResult = await setWallDevices(currentWall.id, deviceRefs);
    setSaving(false);
    if (!devicesResult.ok) {
      // Half-applied save: the wall's name/slug/config ARE live (the PATCH's broadcast
      // already re-rendered any open TVs) but the device assignment is NOT. Say
      // exactly that -- a generic "save failed" would leave the admin believing the
      // TVs are untouched and the whole form unsaved. The baseline resets (those form
      // fields genuinely saved, so the dirty state stays truthful) and
      // `deviceSaveFailed` keeps the Save button enabled for a retry of the device
      // write -- see its declaration comment.
      setCurrentWall(result.data);
      setBaseline(JSON.stringify({ form, name, slug }));
      setDeviceSaveFailed(true);
      setErrors([
        'Wall settings (name, slug, layout) were saved and pushed to TVs, but the device '
        + `assignment was NOT updated: ${devicesResult.message}. `
        + 'Press "Save to TVs" again to retry the device assignment.',
      ]);
      onSaved(result.data);
      return;
    }

    setDeviceSaveFailed(false);
    setCurrentWall(result.data);
    setBaseline(JSON.stringify({ form, name, slug }));
    setSavedNotice(true);
    onSaved(result.data);
  }

  return (
    <div data-testid="wall-editor">
      <header className="wall-editor__toolbar" data-testid="wall-editor-toolbar">
        <button type="button" className="wall-editor__back" data-testid="wall-editor-back" onClick={onBack}>
          &larr; Walls
        </button>
        <h1 className="wall-editor__toolbar-name font-display">{currentWall.name}</h1>
        <span className="wall-editor__live-chip" data-testid="wall-editor-live-chip">
          <span className="wall-editor__live-dot" />
          LIVE PREVIEW
        </span>
        <span
          className={`wall-editor__status wall-editor__status--${dirty ? 'dirty' : 'clean'}`}
          data-testid="wall-editor-status"
        >
          {statusText}
        </span>
        <button
          type="submit"
          form="wall-editor-form"
          className={dirty ? 'wall-editor__save wall-editor__save--dirty' : 'wall-editor__save'}
          data-testid="wall-editor-save"
          disabled={(!dirty && !deviceSaveFailed) || saving}
        >
          {saving ? 'Saving…' : 'Save to TVs'}
        </button>
      </header>

      <div className={`wall-editor wall-editor--preview-${previewSize}`} data-preview-size={previewSize}>
        <form id="wall-editor-form" className="wall-editor__form" data-testid="wall-editor-form" onSubmit={handleSave}>
          {!bannerDismissed && (
            <div className="wall-editor__banner" data-testid="wall-editor-banner">
              <span>
                Everything you change previews instantly on the right. TVs don&rsquo;t change until you hit
                {' '}<strong>Save to TVs</strong>.
              </span>
              <button
                type="button"
                className="wall-editor__banner-dismiss"
                data-testid="wall-editor-banner-dismiss"
                onClick={() => setBannerDismissed(true)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          <input
            type="search"
            className="wall-editor__search"
            data-testid="wall-editor-search"
            placeholder="Search settings…"
            value={settingsQuery}
            onChange={(e) => setSettingsQuery(e.target.value)}
          />
          <div className="wall-editor__grid">
            <label className="admin-field">
              <span>Name</span>
              <input
                type="text"
                data-testid="wall-editor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Slug</span>
              <input
                type="text"
                data-testid="wall-editor-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Look</span>
              <select
                data-testid="wall-editor-look"
                value={form.look}
                onChange={(e) => updateField('look', e.target.value as WallConfig['look'])}
              >
                {LOOKS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Glyph style</span>
              <select
                data-testid="wall-editor-glyph-mode"
                value={form.glyphMode}
                onChange={(e) => updateField('glyphMode', e.target.value as WallConfig['glyphMode'])}
              >
                {GLYPH_MODES.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Pour takeover</span>
              <select
                data-testid="wall-editor-takeover-style"
                value={form.takeoverStyle}
                onChange={(e) => updateField('takeoverStyle', e.target.value as WallConfig['takeover']['style'])}
              >
                {TAKEOVER_STYLES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="wall-editor__simulate"
              data-testid="wall-editor-simulate-pour"
              onClick={() => setSimulateNonce((n) => n + 1)}
            >
              ▶ Simulate a pour
            </button>
            <label className="admin-field">
              <span>Takeover trigger (mL)</span>
              <input
                type="number"
                min={0}
                data-testid="wall-editor-takeover-min"
                value={form.takeoverMinMl}
                onChange={(e) => updateField('takeoverMinMl', Number(e.target.value))}
              />
            </label>
            <label className="admin-field">
              <span>Columns</span>
              <select
                data-testid="wall-editor-columns"
                value={form.columns}
                onChange={(e) => updateField('columns', Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Card template</span>
              <select
                data-testid="wall-editor-template"
                value={form.cardTemplate}
                onChange={(e) => updateCardTemplate(e.target.value as CardTemplate)}
              >
                {CARD_TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Fill style</span>
              <select
                data-testid="wall-editor-fill-style"
                value={form.fillStyle}
                onChange={(e) => updateField('fillStyle', e.target.value as WallConfig['fillStyle'])}
              >
                {FILL_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <fieldset
            className="wall-editor__section"
            style={{ display: matchesQuery('card fields', 'label image', 'brewery', 'style', 'abv', 'ibu', 'description', 'last pour') ? undefined : 'none' }}
          >
            <legend>Card fields</legend>
            <div className="wall-editor__field-toggles">
              {FIELD_KEYS.map((key) => (
                <label key={key} className="wall-editor__checkbox">
                  <input
                    type="checkbox"
                    data-testid={`wall-editor-field-${key}`}
                    checked={form.fields[key]}
                    onChange={(e) => updateFieldToggle(key, e.target.checked)}
                  />
                  {FIELD_LABELS[key]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset
            className="wall-editor__section"
            style={{ display: matchesQuery('theme', 'color', 'override', 'accent', 'background') ? undefined : 'none' }}
          >
            <legend>Theme</legend>
            <label className="admin-field">
              <span>Theme</span>
              <select
                data-testid="wall-editor-theme"
                value={form.themeId}
                onChange={(e) => updateField('themeId', e.target.value)}
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <div className="wall-editor__tokens">
              {WALL_TOKEN_KEYS.map((key) => {
                const isColor = key !== '--card-radius';
                const override = form.themeOverrides[key];
                const themeDefault = activeTheme.tokens[key] ?? '';
                return (
                  <label key={key} className="wall-editor__token-row">
                    <span className="wall-editor__token-label">{TOKEN_LABELS[key]}</span>
                    <input
                      type={isColor ? 'color' : 'text'}
                      data-testid={`wall-editor-token-${key}`}
                      value={override !== '' ? override : themeDefault}
                      onChange={(e) => updateTokenOverride(key, e.target.value)}
                    />
                    <button
                      type="button"
                      data-testid={`wall-editor-token-reset-${key}`}
                      disabled={override === ''}
                      onClick={() => updateTokenOverride(key, '')}
                    >
                      Reset
                    </button>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="admin-field admin-field--full">
            <span>Custom CSS</span>
            <textarea
              className="wall-editor__css-textarea"
              data-testid="wall-editor-custom-css"
              value={form.customCss}
              onChange={(e) => updateField('customCss', e.target.value)}
            />
          </label>
          <p className="wall-editor__css-warning" data-testid="wall-editor-css-warning">
            Custom CSS runs on every screen showing this wall — only paste CSS you trust.
          </p>

          {tapsStatus === 'loading' && (
            <p className="admin-page-quiet" data-testid="wall-editor-taps-loading">Loading taps…</p>
          )}
          {tapsStatus === 'error' && (
            <p className="admin-page-quiet" role="alert" data-testid="wall-editor-taps-error">
              Couldn&rsquo;t load taps. Reload to try again.
            </p>
          )}
          <section className="wall-editor__devices" data-testid="wall-editor-devices">
            <h3 className="font-display">DEVICES</h3>
            <p className="admin-page-quiet">
              This wall shows only taps fed by the Kegtron devices checked here.
            </p>
            {devicesStatus === 'loading' && (
              <p className="admin-page-quiet" data-testid="wall-editor-devices-loading">Loading devices…</p>
            )}
            {devicesStatus === 'error' && (
              <p className="admin-page-quiet" role="alert" data-testid="wall-editor-devices-error">
                Couldn&rsquo;t load devices. Reload to try again.
              </p>
            )}
            {devicesStatus === 'loaded' && deviceGroups.length === 0 && (
              <p className="admin-page-quiet" data-testid="wall-editor-devices-empty">
                No Kegtron devices discovered yet.
              </p>
            )}
            {devicesStatus === 'loaded' && deviceGroups.map((group) => {
              const boundTaps = group.ports
                .map((port) => taps.find((t) => t.id === port.tapId) ?? null)
                .filter((t): t is Tap => t != null);
              return (
                <label className="wall-editor__device" data-testid="wall-editor-device" key={group.key}>
                  <input
                    type="checkbox"
                    data-testid="wall-editor-device-checkbox"
                    checked={selectedDeviceKeys.has(group.key)}
                    onChange={(e) => toggleDevice(group.key, e.target.checked)}
                  />
                  <span>{deviceLabel(group)}</span>
                  <span className="admin-page-quiet">
                    {group.ports.length} {group.ports.length === 1 ? 'port' : 'ports'}
                    {boundTaps.length > 0
                      ? ` · taps ${boundTaps.map((t) => t.name ?? t.number).join(', ')}`
                      : ' · no taps bound'}
                  </span>
                </label>
              );
            })}
            {devicesStatus === 'loaded' && selectedDeviceKeys.size === 0 && (
              <p role="alert" data-testid="wall-editor-devices-none-warning">
                No devices selected — this wall will show no taps.
              </p>
            )}
          </section>

          {tapsStatus === 'loaded' && (
            <WallPagesBuilder pages={form.pages} taps={allowedTaps} onChange={(pages) => updateField('pages', pages)} />
          )}

          <div className="wall-editor__grid">
            <label className="admin-field">
              <span>Rotation seconds</span>
              <input
                type="number"
                data-testid="wall-editor-rotation"
                value={form.rotationSeconds}
                onChange={(e) => updateField('rotationSeconds', Number(e.target.value))}
              />
            </label>
            <label className="admin-field">
              <span>Transition</span>
              <select
                data-testid="wall-editor-transition"
                value={form.transition}
                onChange={(e) => updateField('transition', e.target.value as WallConfigFormState['transition'])}
              >
                <option value="crossfade">Crossfade</option>
                <option value="slide">Slide</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-show-qr"
                checked={form.showQr}
                onChange={(e) => updateField('showQr', e.target.checked)}
              />
              Show QR code
            </label>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-show-host-stats"
                checked={form.showHostStats}
                onChange={(e) => updateField('showHostStats', e.target.checked)}
              />
              Show server stats (CPU / RAM / disk)
            </label>
          </div>

          <fieldset
            className="wall-editor__section"
            style={{ display: matchesQuery('header', 'title', 'announcement', 'clock', 'temperature') ? undefined : 'none' }}
          >
            <legend>Header</legend>
            <label className="admin-field">
              <span>Title</span>
              <input
                type="text"
                data-testid="wall-editor-header-title"
                value={form.headerTitle}
                onChange={(e) => updateField('headerTitle', e.target.value)}
                placeholder={currentWall.name}
              />
            </label>
            <label className="admin-field">
              <span>Announcement</span>
              <input
                type="text"
                data-testid="wall-editor-header-subtitle"
                value={form.headerSubtitle}
                onChange={(e) => updateField('headerSubtitle', e.target.value)}
                placeholder="Trivia night Thursdays at 7"
              />
            </label>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-show-clock"
                checked={form.showClock}
                onChange={(e) => updateField('showClock', e.target.checked)}
              />
              Show clock
            </label>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-show-temp"
                checked={form.showTemp}
                onChange={(e) => updateField('showTemp', e.target.checked)}
              />
              Show temperature
            </label>
          </fieldset>

          <label className="admin-field admin-field--full">
            <span>Ticker</span>
            <input
              type="text"
              data-testid="wall-editor-ticker"
              value={form.ticker}
              onChange={(e) => updateField('ticker', e.target.value)}
            />
          </label>

          <fieldset
            className="wall-editor__section"
            style={{ display: matchesQuery('view rotation', 'playlist', 'leaderboard', 'seconds') ? undefined : 'none' }}
          >
            <legend>View rotation</legend>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-rotation-enabled"
                checked={form.viewRotationEnabled}
                onChange={(e) => updateField('viewRotationEnabled', e.target.checked)}
              />
              Rotate through a playlist of views (a live pour always interrupts)
            </label>
            {form.viewRotationViews.map((view, i) => (
              <div key={view.kind} className="wall-editor__rotation-view">
                <label className="wall-editor__checkbox">
                  <input
                    type="checkbox"
                    data-testid={`wall-editor-rotation-view-${view.kind}`}
                    checked={view.enabled}
                    onChange={(e) => {
                      const views = form.viewRotationViews.map((v, j) => (j === i ? { ...v, enabled: e.target.checked } : v));
                      updateField('viewRotationViews', views);
                    }}
                  />
                  {view.kind === 'wall' ? 'Kegwall' : 'Leaderboard'}
                </label>
                <label className="admin-field">
                  <span>Seconds</span>
                  <input
                    type="number"
                    min={3}
                    max={600}
                    data-testid={`wall-editor-rotation-seconds-${view.kind}`}
                    value={view.seconds}
                    onChange={(e) => {
                      const views = form.viewRotationViews.map((v, j) => (j === i ? { ...v, seconds: Number(e.target.value) } : v));
                      updateField('viewRotationViews', views);
                    }}
                  />
                </label>
              </div>
            ))}
          </fieldset>

          <fieldset
            className="wall-editor__section"
            data-testid="wall-editor-display-fit"
            style={{ display: matchesQuery('display fit', 'screen size', 'resolution', 'ui scale') ? undefined : 'none' }}
          >
            <legend>Display fit</legend>
            <label className="admin-field">
              <span>Screen size</span>
              <select
                data-testid="wall-editor-display-size"
                value={form.displaySizeIn}
                onChange={(e) => updateDisplaySize(Number(e.target.value))}
              >
                {SCREEN_SIZES.map((s) => <option key={s} value={s}>{`${s}"`}</option>)}
              </select>
            </label>
            <div className="wall-editor__seg" role="group" aria-label="Resolution" data-testid="wall-editor-display-resolution">
              {RESOLUTIONS.map((r) => (
                <button
                  type="button"
                  key={r.value}
                  className={form.displayResolution === r.value ? 'wall-editor__seg-btn wall-editor__seg-btn--active' : 'wall-editor__seg-btn'}
                  data-testid={`wall-editor-display-resolution-${r.value}`}
                  aria-pressed={form.displayResolution === r.value}
                  onClick={() => updateDisplayResolution(r.value)}
                >
                  <span className="wall-editor__seg-main">{r.label}</span>
                  <span className="wall-editor__seg-sub font-tabular">{r.px}</span>
                </button>
              ))}
            </div>
            <label className="admin-field">
              <span data-testid="wall-editor-display-ui-scale-label">{`UI scale — ${Math.round(form.displayUiScale * 100)}%`}</span>
              <input
                type="range"
                min={70}
                max={150}
                step={5}
                data-testid="wall-editor-display-ui-scale"
                value={Math.round(form.displayUiScale * 100)}
                onChange={(e) => updateField('displayUiScale', Number(e.target.value) / 100)}
              />
            </label>
            <button type="button" className="wall-editor__reset-scale" data-testid="wall-editor-display-ui-scale-reset" onClick={resetUiScale}>
              Reset to default
            </button>
            <p className="admin-page-quiet">
              Bigger scale = bigger type on the TV. Pick your screen size and resolution and we&rsquo;ll suggest a starting scale you can nudge.
            </p>
          </fieldset>

          <fieldset
            className="wall-editor__section"
            style={{ display: matchesQuery('display power', 'screensaver', 'screens off', 'camera motion') ? undefined : 'none' }}
          >
            <legend>Display power</legend>
            <label className="admin-field">
              <span>Screensaver after (minutes, blank = never)</span>
              <input
                type="number"
                min={1}
                data-testid="wall-editor-display-power-screensaver-minutes"
                value={form.displayPowerScreensaverAfterMinutes ?? ''}
                onChange={(e) => updateField(
                  'displayPowerScreensaverAfterMinutes',
                  e.target.value === '' ? null : Number(e.target.value),
                )}
              />
            </label>
            <label className="admin-field">
              <span>Screens off after (minutes, blank = never)</span>
              <input
                type="number"
                min={2}
                data-testid="wall-editor-display-power-off-minutes"
                value={form.displayPowerOffAfterMinutes ?? ''}
                onChange={(e) => updateField(
                  'displayPowerOffAfterMinutes',
                  e.target.value === '' ? null : Number(e.target.value),
                )}
              />
            </label>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-display-power-camera-motion"
                checked={form.displayPowerCameraMotion}
                onChange={(e) => updateField('displayPowerCameraMotion', e.target.checked)}
              />
              Camera motion wake (tablet)
            </label>
          </fieldset>

          {errors && (
            <ul className="wall-editor__errors" role="alert" data-testid="wall-editor-errors">
              {errors.map((err, i) => (
                // eslint-disable-next-line react/no-array-index-key -- error strings have no stable id
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}

          <div className="wall-editor__save-row">
            <p className="wall-editor__live-note" data-testid="wall-editor-live-note">
              Changes preview live on the right. Save to TVs pushes this layout to any screen currently
              showing this wall.
            </p>
            {savedNotice && !dirty && <p data-testid="wall-editor-saved-notice">Saved.</p>}
          </div>
        </form>

        <div className="wall-editor__preview" data-testid="wall-editor-preview">
          <div className="wall-editor__preview-label">
            <span className="font-tabular" data-testid="wall-editor-preview-label">
              {`PREVIEWING · ${form.displaySizeIn}-inch · ${previewResPx} · UI scale ${Math.round(form.displayUiScale * 100)}%`}
            </span>
            <span className="admin-page-quiet">Full 16:9 frame — exactly what the TV shows.</span>
            <div
              className="wall-editor__seg wall-editor__preview-size"
              role="group"
              aria-label="Preview size"
              data-testid="wall-editor-preview-size"
            >
              {PREVIEW_SIZES.map((s) => (
                <button
                  type="button"
                  key={s.value}
                  className={previewSize === s.value ? 'wall-editor__seg-btn wall-editor__seg-btn--active' : 'wall-editor__seg-btn'}
                  data-testid={`wall-editor-preview-size-${s.value}`}
                  aria-pressed={previewSize === s.value}
                  onClick={() => setPreviewSize(s.value)}
                >
                  <span className="wall-editor__seg-main">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <WallLivePreview
            config={previewConfig}
            title={form.headerTitle.trim() || name}
            units="us"
            menuUrl="/menu"
            simulateNonce={simulateNonce}
          />
        </div>
      </div>
    </div>
  );
}
