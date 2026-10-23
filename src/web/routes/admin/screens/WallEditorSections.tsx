import type { ReactNode } from 'react';
import type { Tap } from '../../../../server/db/taps.js';
import type { WallConfig } from '../../../../server/core/wallConfig.js';
import {
  recommendedUiScale, WALL_TOKEN_KEYS, type WallConfigFormState, type WallTokenKey,
} from '../../../lib/wallEditorConfig';
import {
  FIELD_KEYS, TEMPLATE_DEFAULT_FIELDS, type CardTemplate, type FieldKey,
} from '../../../lib/cardFields';
import { deviceLabel, type MonitorDeviceGroup } from '../../../lib/monitorDevices';
import { LOOK_OPTIONS, TAKEOVER_OPTIONS, lookThumbUrl } from '../../../lib/wallCatalog';
import { THEMES, getTheme, themePreview } from '../../../themes/themes';
import { WallPagesBuilder } from '../WallPagesBuilder';
import { Chips, Switch } from '../ui';

/**
 * The Wall Editor studio's inspector panels (Kegwall V2 M9), one per rail section. Each is a
 * plain view over the draft form: it reads `form` and reports edits through `patch`. The
 * studio (WallEditor.tsx) owns the draft, saving and the preview.
 */
export interface SectionProps {
  form: WallConfigFormState;
  patch: (patch: Partial<WallConfigFormState>) => void;
}

function Group({ title, children, help }: { title: string; children: ReactNode; help?: ReactNode }) {
  return (
    <fieldset className="studio-group">
      <legend className="studio-group__title">{title}</legend>
      {help && <p className="studio-group__help">{help}</p>}
      {children}
    </fieldset>
  );
}

function Check({ checked, onChange, testId, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <label className="studio-check">
      <input type="checkbox" data-testid={testId} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function minutesOrNull(raw: string): number | null {
  return raw === '' ? null : Number(raw);
}

// --- Look ------------------------------------------------------------------------------

export function LookSection({ form, patch, taps }: SectionProps & { taps: Tap[] }) {
  return (
    <>
      <div className="studio-looks" role="radiogroup" aria-label="Look" data-testid="wall-editor-look">
        {LOOK_OPTIONS.map((look) => {
          const on = form.look === look.id;
          return (
            <button
              key={look.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="studio-look"
              data-testid={`wall-editor-look-${look.id}`}
              onClick={() => patch({ look: look.id })}
            >
              <img src={lookThumbUrl(look.id)} alt="" loading="lazy" width={400} height={225} />
              <span className="studio-look__name">
                {look.label}
                <small>{on ? 'Selected' : look.isNew ? 'New' : ''}</small>
              </span>
            </button>
          );
        })}
      </div>
      <Group
        title="Spotlight"
        help={form.look === 'just-tapped'
          ? 'The beer Just Tapped puts up front.'
          : 'Used by the Just Tapped look. Saved for when you switch to it.'}
      >
        <Chips
          label="Spotlight"
          testId="wall-editor-spotlight-mode"
          value={form.spotlightMode}
          onChange={(mode) => patch({ spotlightMode: mode, spotlightTapId: mode === 'pinned' ? (form.spotlightTapId ?? taps[0]?.id ?? null) : null })}
          options={[{ value: 'newest', label: 'Newest keg' }, { value: 'pinned', label: 'A tap you pick' }]}
        />
        {form.spotlightMode === 'pinned' && (
          <label className="admin-field">
            <span>Tap</span>
            <select
              data-testid="wall-editor-spotlight-tap"
              value={form.spotlightTapId ?? ''}
              onChange={(e) => patch({ spotlightTapId: e.target.value === '' ? null : Number(e.target.value) })}
            >
              {taps.map((t) => <option key={t.id} value={t.id}>{t.name ?? `Tap ${t.number}`}</option>)}
            </select>
          </label>
        )}
      </Group>
    </>
  );
}

// --- Colors ----------------------------------------------------------------------------

const TOKEN_LABELS: Record<WallTokenKey, string> = {
  '--bg': 'Background',
  '--surface': 'Surface',
  '--text': 'Text',
  '--text-dim': 'Dim text',
  '--accent': 'Accent',
  '--card-radius': 'Card radius',
};

export function ColorsSection({ form, patch }: SectionProps) {
  const activeTheme = getTheme(form.themeId);
  const overridden = WALL_TOKEN_KEYS.filter((k) => form.themeOverrides[k] !== '').length;
  return (
    <>
      {(['dark', 'light'] as const).map((mode) => (
        <Group key={mode} title={mode === 'dark' ? 'Dark grounds' : 'Light grounds'}>
          <div className="studio-themes" role="radiogroup" aria-label={`${mode} themes`}>
            {THEMES.filter((t) => t.mode === mode).map((theme) => {
              const p = themePreview(theme);
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={form.themeId === theme.id}
                  className="studio-theme"
                  data-testid={`wall-editor-theme-${theme.id}`}
                  onClick={() => patch({ themeId: theme.id })}
                >
                  <span className="studio-theme__swatch" style={{ background: p.ground, color: p.ink }} aria-hidden="true">
                    <i style={{ background: p.surface }} />
                    <i style={{ background: p.accent }} />
                    Aa
                  </span>
                  <span>{theme.name}</span>
                </button>
              );
            })}
          </div>
        </Group>
      ))}
      <details className="studio-more" open={overridden > 0 || undefined}>
        <summary>{overridden > 0 ? `Individual colors (${overridden} changed)` : 'Change individual colors'}</summary>
        <div className="studio-tokens">
          {WALL_TOKEN_KEYS.map((key) => {
            const isColor = key !== '--card-radius';
            const override = form.themeOverrides[key];
            return (
              <label key={key} className="studio-token">
                <span>{TOKEN_LABELS[key]}</span>
                <input
                  type={isColor ? 'color' : 'text'}
                  data-testid={`wall-editor-token-${key}`}
                  value={override !== '' ? override : (activeTheme.tokens[key] ?? '')}
                  onChange={(e) => patch({ themeOverrides: { ...form.themeOverrides, [key]: e.target.value } })}
                />
                <button
                  type="button"
                  className="adm-btn adm-btn--quiet"
                  data-testid={`wall-editor-token-reset-${key}`}
                  disabled={override === ''}
                  onClick={() => patch({ themeOverrides: { ...form.themeOverrides, [key]: '' } })}
                >
                  Reset
                </button>
              </label>
            );
          })}
        </div>
      </details>
    </>
  );
}

// --- What shows ------------------------------------------------------------------------

export function ContentSection({
  form, patch, name, slug, onName, onSlug,
}: SectionProps & { name: string; slug: string; onName: (v: string) => void; onSlug: (v: string) => void }) {
  return (
    <>
      <Group title="Name and address">
        <div className="adm-grid-2">
          <label className="admin-field">
            <span>Name</span>
            <input type="text" data-testid="wall-editor-name" value={name} onChange={(e) => onName(e.target.value)} />
          </label>
          <label className="admin-field">
            <span>Address</span>
            <input type="text" data-testid="wall-editor-slug" value={slug} onChange={(e) => onSlug(e.target.value)} />
          </label>
        </div>
        <p className="studio-group__help">{`Screens open it at /wall/${slug || '…'}. Changing the address breaks old links.`}</p>
      </Group>
      <Group title="Header">
        <label className="admin-field">
          <span>Title</span>
          <input
            type="text"
            data-testid="wall-editor-header-title"
            value={form.headerTitle}
            placeholder={name}
            onChange={(e) => patch({ headerTitle: e.target.value })}
          />
        </label>
        <label className="admin-field">
          <span>Announcement</span>
          <input
            type="text"
            data-testid="wall-editor-header-subtitle"
            value={form.headerSubtitle}
            placeholder="Trivia night Thursdays at 7"
            onChange={(e) => patch({ headerSubtitle: e.target.value })}
          />
        </label>
        <Check testId="wall-editor-show-clock" checked={form.showClock} onChange={(v) => patch({ showClock: v })}>Show the clock</Check>
        <Check testId="wall-editor-show-temp" checked={form.showTemp} onChange={(v) => patch({ showTemp: v })}>Show the kegerator temperature</Check>
      </Group>
      <Group title="Along the bottom">
        <label className="admin-field">
          <span>Ticker</span>
          <input
            type="text"
            data-testid="wall-editor-ticker"
            value={form.ticker}
            placeholder="Leave empty for the wall’s own line about tonight"
            onChange={(e) => patch({ ticker: e.target.value })}
          />
        </label>
        <Check testId="wall-editor-show-qr" checked={form.showQr} onChange={(v) => patch({ showQr: v })}>
          Show the QR code to the phone menu
        </Check>
        <Check testId="wall-editor-show-host-stats" checked={form.showHostStats} onChange={(v) => patch({ showHostStats: v })}>
          Show server stats (CPU, memory, disk)
        </Check>
      </Group>
    </>
  );
}

// --- Taps and pages ----------------------------------------------------------------------

export function PagesSection({
  form, patch, taps, allowedTaps, tapsStatus, deviceGroups, devicesStatus, selectedDevices, onToggleDevice,
}: SectionProps & {
  taps: Tap[];
  allowedTaps: Tap[];
  tapsStatus: 'loading' | 'loaded' | 'error';
  deviceGroups: MonitorDeviceGroup[];
  devicesStatus: 'loading' | 'loaded' | 'error';
  selectedDevices: ReadonlySet<string>;
  onToggleDevice: (key: string, checked: boolean) => void;
}) {
  return (
    <>
      <Group title="Monitors" help="This wall shows only the taps fed by the Kegtron monitors checked here.">
        <div data-testid="wall-editor-devices">
          {devicesStatus === 'loading' && <p className="studio-group__help" data-testid="wall-editor-devices-loading">Loading monitors…</p>}
          {devicesStatus === 'error' && (
            <p className="adm-danger-text" role="alert" data-testid="wall-editor-devices-error">Couldn’t load monitors. Reload to try again.</p>
          )}
          {devicesStatus === 'loaded' && deviceGroups.length === 0 && (
            <p className="studio-group__help" data-testid="wall-editor-devices-empty">No Kegtron monitors found yet.</p>
          )}
          {devicesStatus === 'loaded' && deviceGroups.map((group) => {
            const bound = group.ports
              .map((port) => taps.find((t) => t.id === port.tapId) ?? null)
              .filter((t): t is Tap => t != null);
            return (
              <label className="studio-device" data-testid="wall-editor-device" key={group.key}>
                <input
                  type="checkbox"
                  data-testid="wall-editor-device-checkbox"
                  checked={selectedDevices.has(group.key)}
                  onChange={(e) => onToggleDevice(group.key, e.target.checked)}
                />
                <span>
                  <b>{deviceLabel(group)}</b>
                  <small>
                    {`${group.ports.length} ${group.ports.length === 1 ? 'port' : 'ports'}`}
                    {bound.length > 0 ? ` · ${bound.map((t) => t.name ?? `Tap ${t.number}`).join(', ')}` : ' · no taps on it'}
                  </small>
                </span>
              </label>
            );
          })}
          {devicesStatus === 'loaded' && selectedDevices.size === 0 && (
            <p className="adm-warn-text" role="alert" data-testid="wall-editor-devices-none-warning">
              No monitors checked, so this wall will show no taps.
            </p>
          )}
        </div>
      </Group>
      <Group title="Pages" help="With no pages, the wall shows every tap and splits them into pages when the look runs out of room.">
        {tapsStatus === 'loading' && <p className="studio-group__help" data-testid="wall-editor-taps-loading">Loading taps…</p>}
        {tapsStatus === 'error' && (
          <p className="adm-danger-text" role="alert" data-testid="wall-editor-taps-error">Couldn’t load taps. Reload to try again.</p>
        )}
        {tapsStatus === 'loaded' && (
          <WallPagesBuilder pages={form.pages} taps={allowedTaps} onChange={(pages) => patch({ pages })} />
        )}
      </Group>
    </>
  );
}

// --- Pour takeover ---------------------------------------------------------------------

export function TakeoverSection({ form, patch }: SectionProps) {
  const cheersApplies = form.takeoverStyle === 'full' || form.takeoverStyle === 'tappull' || form.takeoverStyle === 'kegdrain';
  return (
    <>
      <div className="studio-options" role="radiogroup" aria-label="Pour takeover" data-testid="wall-editor-takeover-style">
        {TAKEOVER_OPTIONS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={form.takeoverStyle === t.id}
            className="studio-option"
            data-testid={`wall-editor-takeover-${t.id}`}
            onClick={() => patch({ takeoverStyle: t.id })}
          >
            <b>{t.label}</b>
            <span>{t.blurb}</span>
          </button>
        ))}
      </div>
      <Group title="When it ends">
        <Chips
          label="Finish"
          testId="wall-editor-takeover-finish"
          value={form.takeoverFinish}
          onChange={(finish) => patch({ takeoverFinish: finish })}
          options={[{ value: 'plain', label: 'The recorded volume' }, { value: 'cheers', label: 'Cheers' }]}
        />
        <p className="studio-group__help">
          {form.takeoverFinish === 'cheers' && !cheersApplies
            ? 'Cheers plays after a single pour on Full screen, Tap Pull and Keg Drain. This style ends on the recorded volume.'
            : 'Every finish shows the volume the Kegtron recorded, then returns to the wall.'}
        </p>
      </Group>
      <Group title="Start after">
        <label className="admin-field studio-narrow">
          <span>Milliliters poured</span>
          <input
            type="number"
            min={0}
            data-testid="wall-editor-takeover-min"
            value={form.takeoverMinMl}
            onChange={(e) => patch({ takeoverMinMl: Number(e.target.value) })}
          />
        </label>
        <p className="studio-group__help">Drips and tasters under this never take over the screen.</p>
      </Group>
      <Group title="Wall moments" help="A short moment on the wall when these happen. Off by default.">
        <div data-testid="wall-editor-moments" className="studio-switches">
          {([
            ['momentKicked', 'A keg kicks'],
            ['momentTapped', 'A new keg is tapped'],
            ['momentMilestone', 'A pour milestone (the 100th tonight, a pourer’s 50th)'],
          ] as const).map(([key, label]) => (
            <Switch
              key={key}
              data-testid={`wall-editor-${key}`}
              checked={form[key]}
              onCheckedChange={(v) => patch({ [key]: v })}
              label={label}
            />
          ))}
        </div>
      </Group>
    </>
  );
}

// --- Rotation and sleep -----------------------------------------------------------------

export function RotationSection({ form, patch }: SectionProps) {
  return (
    <>
      <Group title="Pages">
        <div className="adm-grid-2">
          <label className="admin-field">
            <span>Seconds per page</span>
            <input
              type="number"
              data-testid="wall-editor-rotation"
              value={form.rotationSeconds}
              onChange={(e) => patch({ rotationSeconds: Number(e.target.value) })}
            />
          </label>
          <label className="admin-field">
            <span>Change pages with</span>
            <select
              data-testid="wall-editor-transition"
              value={form.transition}
              onChange={(e) => patch({ transition: e.target.value as WallConfigFormState['transition'] })}
            >
              <option value="crossfade">A crossfade</option>
              <option value="slide">A slide</option>
              <option value="none">A cut</option>
            </select>
          </label>
        </div>
      </Group>
      <Group title="Views" help="Take turns between the taps and the leaderboard. A pour always interrupts.">
        <Switch
          data-testid="wall-editor-rotation-enabled"
          checked={form.viewRotationEnabled}
          onCheckedChange={(v) => patch({ viewRotationEnabled: v })}
          label="Rotate views"
        />
        {form.viewRotationViews.map((view, i) => (
          <div key={view.kind} className="studio-view">
            <Check
              testId={`wall-editor-rotation-view-${view.kind}`}
              checked={view.enabled}
              onChange={(v) => patch({ viewRotationViews: form.viewRotationViews.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })}
            >
              {view.kind === 'wall' ? 'The taps' : 'The leaderboard'}
            </Check>
            <label className="admin-field studio-narrow">
              <span>Seconds</span>
              <input
                type="number"
                min={3}
                max={600}
                data-testid={`wall-editor-rotation-seconds-${view.kind}`}
                value={view.seconds}
                onChange={(e) => patch({
                  viewRotationViews: form.viewRotationViews.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)),
                })}
              />
            </label>
          </div>
        ))}
      </Group>
      <Group title="Sleep" help="Timers count from the last motion or pour. Leave a box empty to never do that.">
        <div className="adm-grid-2">
          <label className="admin-field">
            <span>Screensaver after (minutes)</span>
            <input
              type="number"
              min={1}
              data-testid="wall-editor-display-power-screensaver-minutes"
              value={form.displayPowerScreensaverAfterMinutes ?? ''}
              onChange={(e) => patch({ displayPowerScreensaverAfterMinutes: minutesOrNull(e.target.value) })}
            />
          </label>
          <label className="admin-field">
            <span>Screen off after (minutes)</span>
            <input
              type="number"
              min={2}
              data-testid="wall-editor-display-power-off-minutes"
              value={form.displayPowerOffAfterMinutes ?? ''}
              onChange={(e) => patch({ displayPowerOffAfterMinutes: minutesOrNull(e.target.value) })}
            />
          </label>
        </div>
        <Check
          testId="wall-editor-display-power-camera-motion"
          checked={form.displayPowerCameraMotion}
          onChange={(v) => patch({ displayPowerCameraMotion: v })}
        >
          Wake when the tablet camera sees motion
        </Check>
      </Group>
    </>
  );
}

// --- Screen fit ------------------------------------------------------------------------

export const SCREEN_SIZES = [32, 43, 50, 55, 65, 75] as const;
export const RESOLUTIONS: { value: WallConfig['display']['resolution']; label: string; px: string }[] = [
  { value: '720p', label: '720p', px: '1280 × 720' },
  { value: '1080p', label: '1080p', px: '1920 × 1080' },
  { value: '4k', label: '4K', px: '3840 × 2160' },
];

export function FitSection({ form, patch }: SectionProps) {
  return (
    <div data-testid="wall-editor-display-fit">
      <Group title="The TV">
        <label className="admin-field studio-narrow">
          <span>Screen size</span>
          <select
            data-testid="wall-editor-display-size"
            value={form.displaySizeIn}
            onChange={(e) => {
              const sizeIn = Number(e.target.value);
              patch({ displaySizeIn: sizeIn, displayUiScale: recommendedUiScale(sizeIn, form.displayResolution) });
            }}
          >
            {SCREEN_SIZES.map((s) => <option key={s} value={s}>{`${s} inch`}</option>)}
          </select>
        </label>
        <div className="studio-seg" role="group" aria-label="Resolution" data-testid="wall-editor-display-resolution">
          {RESOLUTIONS.map((r) => (
            <button
              type="button"
              key={r.value}
              className="studio-seg__btn"
              data-testid={`wall-editor-display-resolution-${r.value}`}
              aria-pressed={form.displayResolution === r.value}
              onClick={() => patch({ displayResolution: r.value, displayUiScale: recommendedUiScale(form.displaySizeIn, r.value) })}
            >
              <b>{r.label}</b>
              <small>{r.px}</small>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Type size" help="Picking a size and resolution suggests a scale. Nudge it from there.">
        <label className="admin-field">
          <span data-testid="wall-editor-display-ui-scale-label">{`UI scale — ${Math.round(form.displayUiScale * 100)}%`}</span>
          <input
            type="range"
            min={70}
            max={150}
            step={5}
            data-testid="wall-editor-display-ui-scale"
            value={Math.round(form.displayUiScale * 100)}
            onChange={(e) => patch({ displayUiScale: Number(e.target.value) / 100 })}
          />
        </label>
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          data-testid="wall-editor-display-ui-scale-reset"
          onClick={() => patch({ displayUiScale: recommendedUiScale(form.displaySizeIn, form.displayResolution) })}
        >
          Use the suggested scale
        </button>
      </Group>
    </div>
  );
}

// --- Custom CSS ------------------------------------------------------------------------

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

export function CssSection({ form, patch, cssErrors }: SectionProps & { cssErrors: string[] }) {
  return (
    <>
      <label className="admin-field">
        <span>CSS for this wall</span>
        <textarea
          className="studio-css"
          data-testid="wall-editor-custom-css"
          spellCheck={false}
          value={form.customCss}
          aria-invalid={cssErrors.length > 0 || undefined}
          onChange={(e) => patch({ customCss: e.target.value })}
        />
      </label>
      {cssErrors.length > 0 && (
        <ul className="adm-danger-text studio-css-errors" data-testid="wall-editor-css-errors">
          {cssErrors.map((err) => <li key={err}>{err}</li>)}
        </ul>
      )}
      <p className="adm-warn-text" data-testid="wall-editor-css-warning">
        Custom CSS runs on every screen showing this wall — only paste CSS you trust.
      </p>
      <p className="studio-group__help">
        Hook into <code>[data-look]</code>, <code>[data-tap-state]</code> and <code>[data-surface]</code>; the older
        class names still work through 2.x.
      </p>
      <details className="studio-more" data-testid="wall-editor-legacy">
        <summary>Kegwall 1.x card settings</summary>
        <p className="studio-group__help">
          The cards these set up were replaced by the looks. They’re kept, and saved, so an older install
          or a downgrade reads the wall the same way.
        </p>
        <div className="adm-grid-2">
          <label className="admin-field">
            <span>Card template</span>
            <select
              data-testid="wall-editor-template"
              value={form.cardTemplate}
              onChange={(e) => {
                const template = e.target.value as CardTemplate;
                // A template switch resets the card fields to the new template's defaults, so the
                // old template's toggles never ship as overrides on the new one.
                patch({ cardTemplate: template, fields: { ...TEMPLATE_DEFAULT_FIELDS[template] } });
              }}
            >
              {CARD_TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span>Columns</span>
            <select data-testid="wall-editor-columns" value={form.columns} onChange={(e) => patch({ columns: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span>Fill style</span>
            <select
              data-testid="wall-editor-fill-style"
              value={form.fillStyle}
              onChange={(e) => patch({ fillStyle: e.target.value as WallConfig['fillStyle'] })}
            >
              <option value="liquid">Beer-colored liquid</option>
              <option value="keg">Keg cutaway</option>
            </select>
          </label>
          <label className="admin-field">
            <span>Glyph style</span>
            <select
              data-testid="wall-editor-glyph-mode"
              value={form.glyphMode}
              onChange={(e) => patch({ glyphMode: e.target.value as WallConfig['glyphMode'] })}
            >
              <option value="flat">Flat fill</option>
              <option value="outline">Outline</option>
              <option value="duotone">Duotone</option>
            </select>
          </label>
        </div>
        <div className="studio-fields">
          {FIELD_KEYS.map((key) => (
            <Check
              key={key}
              testId={`wall-editor-field-${key}`}
              checked={form.fields[key]}
              onChange={(v) => patch({ fields: { ...form.fields, [key]: v } })}
            >
              {FIELD_LABELS[key]}
            </Check>
          ))}
        </div>
      </details>
    </>
  );
}
