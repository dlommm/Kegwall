import { useEffect, useState, type FormEvent } from 'react';
import type { Tap } from '../../../server/db/taps.js';
import { wallConfigSchema } from '../../../server/core/wallConfig.js';
import { listTaps, updateWall, type Wall } from '../../lib/adminApi';
import {
  configToFormState, parseWallConfigForm, WALL_TOKEN_KEYS,
  type WallConfigFormState, type WallTokenKey,
} from '../../lib/wallEditorConfig';
import {
  FIELD_KEYS, TEMPLATE_DEFAULT_FIELDS, type CardTemplate, type FieldKey,
} from '../../lib/cardFields';
import { THEMES, getTheme } from '../../themes/themes';
import { WallPagesBuilder } from './WallPagesBuilder';
import { WallPreview } from './WallPreview';

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

/** A stored wall row's `config` was schema-validated at write time, but older rows can
 * predate a since-added key (e.g. `screensaver`, added after the column already existed
 * — see wallConfig.ts's doc comment) — re-parsing here fills any such gap with the
 * schema's current defaults rather than the editor choking on a partial object. A config
 * that's now outright invalid (shouldn't happen; nothing writes unvalidated config) falls
 * back to schema defaults rather than crashing the whole editor. */
function safeParseConfig(config: unknown) {
  const result = wallConfigSchema.safeParse(config);
  return result.success ? result.data : wallConfigSchema.parse({});
}

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
  const [form, setForm] = useState<WallConfigFormState>(() => configToFormState(safeParseConfig(wall.config)));
  const [taps, setTaps] = useState<Tap[]>([]);
  const [tapsStatus, setTapsStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [errors, setErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);

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
    return () => {
      cancelled = true;
    };
  }, []);

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

  const activeTheme = getTheme(form.themeId);

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

    const validTapIds = taps.map((t) => t.id);
    const parsed = parseWallConfigForm(form, validTapIds);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }

    setErrors(null);
    setSaving(true);
    const result = await updateWall(currentWall.id, {
      name: name.trim(), slug, config: parsed.config,
    });
    setSaving(false);
    if (!result.ok) {
      setErrors([result.message]);
      return;
    }

    setCurrentWall(result.data);
    setPreviewNonce((n) => n + 1);
    setSavedNotice(true);
    onSaved(result.data);
  }

  return (
    <div data-testid="wall-editor">
      <header className="admin-page-header">
        <div className="wall-editor__heading">
          <button type="button" className="wall-editor__back" data-testid="wall-editor-back" onClick={onBack}>
            &larr; Back to walls
          </button>
          <h1 className="admin-page-header__title font-display">{`Edit ${currentWall.name}`}</h1>
        </div>
      </header>

      <div className="wall-editor">
        <form className="wall-editor__form" data-testid="wall-editor-form" onSubmit={handleSave}>
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
          </div>

          <fieldset className="wall-editor__section">
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

          <fieldset className="wall-editor__section">
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
          {tapsStatus === 'loaded' && (
            <WallPagesBuilder pages={form.pages} taps={taps} onChange={(pages) => updateField('pages', pages)} />
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
          </div>

          <fieldset className="wall-editor__section">
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

          <fieldset className="wall-editor__section">
            <legend>Screensaver</legend>
            <label className="wall-editor__checkbox">
              <input
                type="checkbox"
                data-testid="wall-editor-screensaver-enabled"
                checked={form.screensaverEnabled}
                onChange={(e) => updateField('screensaverEnabled', e.target.checked)}
              />
              Enabled
            </label>
            <label className="admin-field">
              <span>Start after (minutes)</span>
              <input
                type="number"
                data-testid="wall-editor-screensaver-minutes"
                value={form.screensaverStartAfterMinutes}
                onChange={(e) => updateField('screensaverStartAfterMinutes', Number(e.target.value))}
              />
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
            <button type="submit" className="beer-form__submit" data-testid="wall-editor-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <p className="wall-editor__live-note" data-testid="wall-editor-live-note">
              Saving pushes this layout live to any screen currently showing this wall.
            </p>
            {savedNotice && <p data-testid="wall-editor-saved-notice">Saved.</p>}
          </div>
        </form>

        <div className="wall-editor__preview">
          <h2 className="admin-field__label-text">Live preview</h2>
          <WallPreview
            slug={currentWall.slug}
            reloadKey={previewNonce}
            testId="wall-editor-preview-frame"
            className="wall-editor__preview-frame"
          />
        </div>
      </div>
    </div>
  );
}
