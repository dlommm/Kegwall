import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Settings } from '../../../server/db/settings.js';
// A real VALUE import (not type-only) of a server `core/` module — see that file's doc
// comment for why this is safe under tsconfig.web.json (a dependency-free module, only a
// type import of db/settings.ts) and why it replaces what used to be a hand-duplicated
// local copy of this same constant.
import { SOURCE_RESTART_KEYS } from '../../../server/core/restartKeys.js';
import {
  getSettings, patchSettings, uploadLabel, testChannel,
  getSystemVersion, checkForUpdates, triggerUpdate, pollSystemVersion, pollUpdateStatus,
  triggerOsUpdate,
  type UpdateCheck,
} from '../../lib/adminApi';
import { BackupPanel } from './BackupPanel';

/**
 * Mirrors `settingsSchema`'s own defaults for `mqtt`'s sub-fields (`db/settings.ts`) —
 * needed here ONLY as a fallback for constructing a brand-new `mqtt` object from scratch
 * when it has never been configured (`settings.mqtt === null`). Once `mqtt` has been
 * configured at all, `GET /api/settings` always returns every sub-field already resolved
 * (`SettingsStore.all()`/`masked()` run the whole thing through `settingsSchema.parse`),
 * so this constant is never consulted after that first save. Can't import the real
 * `settingsSchema` value here instead — this repo's "types via type-only server imports"
 * rule (see Global Constraints) only clears VALUE imports of dependency-free `core/`
 * modules and plain `db/` modules for their TYPES, not for reaching into a zod schema's
 * runtime defaults.
 */
const MQTT_DEFAULTS = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haPublishEnabled: false,
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegwall',
};

function triggersRestart(patch: Partial<Settings>): boolean {
  return Object.keys(patch).some((k) => SOURCE_RESTART_KEYS.includes(k as keyof Settings));
}

interface GroupProps {
  settings: Settings;
  /** Bubbles the fresh, post-save canonical settings up to SettingsPage (so sibling
   * groups sharing `mqtt` — Sources and Integrations — see each other's latest values),
   * plus the exact patch body that was sent (so the page can decide whether to show the
   * restart notice). */
  onSaved: (updated: Settings, patch: Partial<Settings>) => void;
}

/**
 * A masked secret field with a "Replace" affordance (Task 8): shows the server's masked
 * display value (e.g. `••••ikey`, or "Not set") and a Replace button; clicking it swaps in
 * a real text input for a brand-new value. The masked string itself is NEVER treated as
 * a real value to submit — a caller only ever reads `value` (the freshly typed
 * replacement) while `replacing` is true.
 */
function MaskedSecretField({
  label, testId, maskedValue, replacing, value, onStartReplace, onCancelReplace, onChangeValue,
}: {
  label: string;
  testId: string;
  maskedValue: string | null | undefined;
  replacing: boolean;
  value: string;
  onStartReplace: () => void;
  onCancelReplace: () => void;
  onChangeValue: (v: string) => void;
}) {
  return (
    <div className="admin-field masked-secret" data-testid={`${testId}-field`}>
      <span>{label}</span>
      {replacing ? (
        <div className="masked-secret__row">
          <input
            type="password"
            data-testid={`${testId}-input`}
            value={value}
            onChange={(e) => onChangeValue(e.target.value)}
            autoFocus
          />
          <button type="button" data-testid={`${testId}-cancel`} onClick={onCancelReplace}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="masked-secret__row">
          <span className="masked-secret__value" data-testid={`${testId}-masked`}>
            {maskedValue || 'Not set'}
          </span>
          <button type="button" data-testid={`${testId}-replace`} onClick={onStartReplace}>
            Replace
          </button>
        </div>
      )}
    </div>
  );
}

/** Site group (Task 8; Phase 5 Task 0 adds `siteLogo` upload + `servingSizeMl`):
 * siteName, displayUnits, a site logo (reuses the beers-form label-upload infra — same
 * generic `POST /api/uploads/label` endpoint, same stored-path convention), and the
 * default serving size (mL) used to estimate remaining servings. Nothing else in the
 * admin UI renders `siteLogo` yet (no consumer was in scope for this change — see the
 * Phase 4 final review's framing of this as "a two-sided gap"; this closes the upload
 * side only), same as `servingSizeMl` not yet feeding any estimate elsewhere. */
function SiteGroup({ settings, onSaved }: GroupProps) {
  const [siteName, setSiteName] = useState(settings.siteName);
  const [displayUnits, setDisplayUnits] = useState(settings.displayUnits);
  const [siteLogo, setSiteLogo] = useState(settings.siteLogo);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [servingSizeMl, setServingSizeMl] = useState(String(settings.servingSizeMl));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = siteName !== settings.siteName
    || displayUnits !== settings.displayUnits
    || siteLogo !== settings.siteLogo
    || servingSizeMl !== String(settings.servingSizeMl);

  async function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-selected later (e.g. after an error)
    if (!file) return;
    setLogoError(null);
    setLogoBusy(true);
    const result = await uploadLabel(file);
    setLogoBusy(false);
    if (result.ok) {
      setSiteLogo(result.data.path);
    } else {
      setLogoError(result.message);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (!siteName.trim()) {
      setError('Site name is required.');
      return;
    }
    const servingSize = Number(servingSizeMl.trim());
    if (!Number.isInteger(servingSize) || servingSize <= 0) {
      setError('Serving size must be a whole number of mL greater than 0.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {};
    if (siteName !== settings.siteName) patch.siteName = siteName.trim();
    if (displayUnits !== settings.displayUnits) patch.displayUnits = displayUnits;
    if (siteLogo !== settings.siteLogo) patch.siteLogo = siteLogo;
    if (servingSize !== settings.servingSizeMl) patch.servingSizeMl = servingSize;
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form className="settings-group" data-testid="settings-group-site" onSubmit={handleSubmit} aria-labelledby="settings-site-title">
      <h2 id="settings-site-title" className="admin-field__label-text">Site</h2>
      <div className="settings-group__grid">
        <label className="admin-field">
          <span>Site name</span>
          <input
            type="text"
            data-testid="settings-site-name"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Units</span>
          <select
            data-testid="settings-site-units"
            value={displayUnits}
            onChange={(e) => setDisplayUnits(e.target.value as Settings['displayUnits'])}
          >
            <option value="us">US (oz, °F)</option>
            <option value="metric">Metric (mL, °C)</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Default serving size (mL)</span>
          <input
            type="text"
            inputMode="numeric"
            data-testid="settings-site-serving-size"
            value={servingSizeMl}
            onChange={(e) => setServingSizeMl(e.target.value)}
          />
        </label>
      </div>

      <div className="beer-form__label">
        <span className="admin-field__label-text">Site logo</span>
        <div className="beer-form__label-row">
          {siteLogo ? (
            <img
              src={siteLogo}
              alt=""
              className="beer-form__label-thumb"
              data-testid="settings-site-logo-thumb"
            />
          ) : (
            <span className="beer-form__label-placeholder" data-testid="settings-site-logo-placeholder">
              No logo
            </span>
          )}

          <label className="beer-form__upload-button">
            {logoBusy ? 'Uploading…' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-testid="settings-site-logo-file"
              onChange={handleLogoFileChange}
              disabled={logoBusy}
              hidden
            />
          </label>

          {siteLogo && (
            <button
              type="button"
              className="beer-form__label-clear"
              data-testid="settings-site-logo-clear"
              onClick={() => setSiteLogo(null)}
            >
              Remove logo
            </button>
          )}
        </div>
        {logoError && (
          <p className="beer-form__notice" role="alert" data-testid="settings-site-logo-error">{logoError}</p>
        )}
      </div>

      {error && <p className="beer-form__notice" role="alert" data-testid="settings-site-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-site-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

/** Kegtron group (Task 8): just the mdash.net API key, masked with a Replace affordance. */
function KegtronGroup({ settings, onSaved }: GroupProps) {
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = replacing && newKey.trim() !== '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = { kegtronApiKey: newKey.trim() };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form className="settings-group" data-testid="settings-group-kegtron" onSubmit={handleSubmit} aria-labelledby="settings-kegtron-title">
      <h2 id="settings-kegtron-title" className="admin-field__label-text">Kegtron</h2>
      <p className="admin-page-quiet">
        The mdash.net API key used to import Kegtron Pro devices and reset on-device volume counters.
      </p>
      <MaskedSecretField
        label="API key"
        testId="settings-kegtron-apikey"
        maskedValue={settings.kegtronApiKey}
        replacing={replacing}
        value={newKey}
        onStartReplace={() => { setReplacing(true); setNewKey(''); }}
        onCancelReplace={() => { setReplacing(false); setNewKey(''); }}
        onChangeValue={setNewKey}
      />
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-kegtron-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-kegtron-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

/** Sources group (Task 8): UDP toggle (+ LAN note), BLE toggle, and MQTT url/user/pass/
 * prefix. `mqtt` is ONE settings key shared with the Integrations group's HA fields below
 * — saving here always sends the FULL current mqtt object (this group's own edits merged
 * over whatever Integrations' fields currently are, from `settings.mqtt`), so a Sources
 * save never clobbers an HA publish toggle/discovery prefix Integrations already set, and
 * vice versa. An untouched password re-sends its masked display value, which the server's
 * `sanitizePatch` swaps back for the real stored one (never a literal new secret). */
function SourcesGroup({ settings, onSaved }: GroupProps) {
  const mqtt = settings.mqtt;
  const [udpEnabled, setUdpEnabled] = useState(settings.udpEnabled);
  const [bleDirectEnabled, setBleDirectEnabled] = useState(settings.bleDirectEnabled);
  const [proBleEnabled, setProBleEnabled] = useState(settings.proBleEnabled);
  const [mqttUrl, setMqttUrl] = useState(mqtt?.url ?? '');
  const [mqttUsername, setMqttUsername] = useState(mqtt?.username ?? '');
  const [mqttPrefix, setMqttPrefix] = useState(mqtt?.gen1TopicPrefix ?? MQTT_DEFAULTS.gen1TopicPrefix);
  const [passwordReplacing, setPasswordReplacing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const udpDirty = udpEnabled !== settings.udpEnabled;
  const bleDirty = bleDirectEnabled !== settings.bleDirectEnabled;
  const proBleDirty = proBleEnabled !== settings.proBleEnabled;
  const mqttDirty = mqttUrl !== (mqtt?.url ?? '')
    || mqttUsername !== (mqtt?.username ?? '')
    || mqttPrefix !== (mqtt?.gen1TopicPrefix ?? MQTT_DEFAULTS.gen1TopicPrefix)
    || (passwordReplacing && newPassword.trim() !== '');
  const dirty = udpDirty || bleDirty || proBleDirty || mqttDirty;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (mqttDirty && !mqttUrl.trim()) {
      setError('An MQTT broker URL is required to save MQTT settings.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {};
    if (udpDirty) patch.udpEnabled = udpEnabled;
    if (bleDirty) patch.bleDirectEnabled = bleDirectEnabled;
    if (proBleDirty) patch.proBleEnabled = proBleEnabled;
    if (mqttDirty) {
      patch.mqtt = {
        url: mqttUrl.trim(),
        username: mqttUsername.trim() || undefined,
        password: passwordReplacing && newPassword.trim() ? newPassword.trim() : mqtt?.password,
        gen1TopicPrefix: mqttPrefix.trim() || MQTT_DEFAULTS.gen1TopicPrefix,
        haPublishEnabled: mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled,
        haDiscoveryPrefix: mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix,
        appTopicPrefix: mqtt?.appTopicPrefix ?? MQTT_DEFAULTS.appTopicPrefix,
      };
    }
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form className="settings-group" data-testid="settings-group-sources" onSubmit={handleSubmit} aria-labelledby="settings-sources-title">
      <h2 id="settings-sources-title" className="admin-field__label-text">Sources</h2>

      <label className="settings-toggle">
        <input
          type="checkbox"
          data-testid="settings-sources-udp"
          checked={udpEnabled}
          onChange={(e) => setUdpEnabled(e.target.checked)}
        />
        <span>Listen for Kegtron UDP broadcasts</span>
      </label>
      <p className="admin-page-quiet settings-toggle__note">
        Only detects devices broadcasting on this server&rsquo;s local network — not across the internet.
      </p>

      <label className="settings-toggle">
        <input
          type="checkbox"
          data-testid="settings-sources-ble"
          checked={bleDirectEnabled}
          onChange={(e) => setBleDirectEnabled(e.target.checked)}
        />
        <span>Listen for Kegtron Gen 1 Bluetooth adverts directly</span>
      </label>

      <label className="settings-toggle">
        <input
          type="checkbox"
          data-testid="settings-sources-pro-ble"
          checked={proBleEnabled}
          onChange={(e) => setProBleEnabled(e.target.checked)}
        />
        <span>Listen for Kegtron Pro Bluetooth adverts (pour fallback — no live pours)</span>
      </label>
      <p className="admin-page-quiet settings-toggle__note">
        Pros only report over Bluetooth at the END of a pour — live pour progress still needs UDP.
      </p>

      <div className="settings-group__grid">
        <label className="admin-field">
          <span>MQTT broker URL</span>
          <input
            type="text"
            data-testid="settings-sources-mqtt-url"
            placeholder="mqtt://host:1883"
            value={mqttUrl}
            onChange={(e) => setMqttUrl(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>MQTT username</span>
          <input
            type="text"
            data-testid="settings-sources-mqtt-username"
            value={mqttUsername}
            onChange={(e) => setMqttUsername(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Gen 1 topic prefix</span>
          <input
            type="text"
            data-testid="settings-sources-mqtt-prefix"
            value={mqttPrefix}
            onChange={(e) => setMqttPrefix(e.target.value)}
          />
        </label>
      </div>
      <MaskedSecretField
        label="MQTT password"
        testId="settings-sources-mqtt-password"
        maskedValue={mqtt?.password}
        replacing={passwordReplacing}
        value={newPassword}
        onStartReplace={() => { setPasswordReplacing(true); setNewPassword(''); }}
        onCancelReplace={() => { setPasswordReplacing(false); setNewPassword(''); }}
        onChangeValue={setNewPassword}
      />

      {error && <p className="beer-form__notice" role="alert" data-testid="settings-sources-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-sources-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

/** Home Assistant publish toggle + discovery prefix (Task 8) — its own form/Save inside
 * the Integrations group. The HA fields live inside the same `mqtt` settings key Sources
 * owns url/user/pass/prefix for — see SourcesGroup's doc comment for the shared-key merge
 * approach used here too. Split out of what used to be all of `IntegrationsGroup` so the
 * unrelated `CatalogBeerBlock` below (a fully independent settings key) can save on its
 * own, without either block's submit disturbing the other's unsaved draft or triggering
 * the wrong version-bump/remount (see SettingsPage's `catalogBeerVersion` doc comment). */
function HomeAssistantBlock({ settings, onSaved }: GroupProps) {
  const mqtt = settings.mqtt;
  const [haPublishEnabled, setHaPublishEnabled] = useState(mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled);
  const [haDiscoveryPrefix, setHaDiscoveryPrefix] = useState(mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = haPublishEnabled !== (mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled)
    || haDiscoveryPrefix !== (mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (!mqtt?.url) {
      setError('Configure an MQTT broker URL in the Sources group first — Home Assistant publishing goes out over MQTT.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {
      mqtt: {
        ...mqtt,
        haPublishEnabled,
        haDiscoveryPrefix: haDiscoveryPrefix.trim() || MQTT_DEFAULTS.haDiscoveryPrefix,
      },
    };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form className="channels-group__block" data-testid="settings-integrations-ha" onSubmit={handleSubmit}>
      <label className="settings-toggle">
        <input
          type="checkbox"
          data-testid="settings-integrations-ha-publish"
          checked={haPublishEnabled}
          onChange={(e) => setHaPublishEnabled(e.target.checked)}
        />
        <span>Publish tap states to Home Assistant over MQTT</span>
      </label>
      <label className="admin-field">
        <span>Home Assistant discovery prefix</span>
        <input
          type="text"
          data-testid="settings-integrations-ha-prefix"
          value={haDiscoveryPrefix}
          onChange={(e) => setHaDiscoveryPrefix(e.target.value)}
        />
      </label>

      {error && <p className="beer-form__notice" role="alert" data-testid="settings-integrations-error">{error}</p>}
      <button type="submit" className="beer-form__submit" disabled={!dirty || submitting} data-testid="settings-integrations-save">
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

/** catalog.beer beer search's API key (Wave N; replaces the removed Untappd search) — a
 * fully independent settings key (`catalogBeer`, not shared with anything else), so this
 * gets its own form + Save, self-resetting its local "replacing" state after a successful
 * save (same idiom as ChannelsGroup's Pushover/SMTP/webhook blocks) rather than relying on
 * a page-level remount. Note the free-tier limit right in the UI (1,000 requests/month) so
 * an admin isn't surprised by a 429 later. */
function CatalogBeerBlock({ settings, onSaved }: GroupProps) {
  const cfg = settings.catalogBeer;
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = replacing && newKey.trim() !== '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = { catalogBeer: { apiKey: newKey.trim() } };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReplacing(false);
    setNewKey('');
    onSaved(result.data, patch);
  }

  return (
    <form
      className="channels-group__block"
      data-testid="settings-integrations-catalogbeer"
      onSubmit={handleSubmit}
    >
      <h3 className="channels-group__block-title">Catalog.beer</h3>
      <p className="admin-page-quiet">
        Powers the beers form&rsquo;s &ldquo;Search catalog.beer&rdquo; lookup (optional — bring your
        own API key). Free tier: 1,000 requests/month.
      </p>
      <MaskedSecretField
        label="API key"
        testId="settings-integrations-catalogbeer-apikey"
        maskedValue={cfg?.apiKey}
        replacing={replacing}
        value={newKey}
        onStartReplace={() => { setReplacing(true); setNewKey(''); }}
        onCancelReplace={() => { setReplacing(false); setNewKey(''); }}
        onChangeValue={setNewKey}
      />
      {error && (
        <p className="beer-form__notice" role="alert" data-testid="settings-integrations-catalogbeer-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="beer-form__submit"
        disabled={!dirty || submitting}
        data-testid="settings-integrations-catalogbeer-save"
      >
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

/** Govee ambient sensors (Pour Wall Phase 6): API key (masked like catalog.beer)
 * + the beer auto-import toggle (design 6g) in one compact block. Discovered
 * sensors appear on the Monitors page, where per-sensor rename and enable/disable
 * live. Saving the key restarts sources (`govee` is a SOURCE_RESTART_KEY) so
 * polling starts immediately. */
function GoveeBlock({ settings, onSaved }: GroupProps) {
  const cfg = settings.govee;
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [autoImport, setAutoImport] = useState(settings.autoImportBeers);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = (replacing && newKey.trim() !== '') || autoImport !== settings.autoImportBeers;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {};
    if (replacing && newKey.trim() !== '') {
      patch.govee = { apiKey: newKey.trim() };
    }
    if (autoImport !== settings.autoImportBeers) patch.autoImportBeers = autoImport;
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReplacing(false);
    setNewKey('');
    onSaved(result.data, patch);
  }

  return (
    <form
      className="channels-group__block"
      data-testid="settings-integrations-govee"
      onSubmit={handleSubmit}
    >
      <h3 className="channels-group__block-title">Govee sensors &amp; auto-import</h3>
      <p className="admin-page-quiet">
        Govee cloud API key for ambient temp/humidity sensors (polled ~60s; chips show on the
        wall header). Discovered sensors appear on the Monitors page — rename or
        enable/disable them there; charts live in Analytics.
      </p>
      <MaskedSecretField
        label="Govee API key"
        testId="settings-integrations-govee-apikey"
        maskedValue={cfg?.apiKey}
        replacing={replacing}
        value={newKey}
        onStartReplace={() => { setReplacing(true); setNewKey(''); }}
        onCancelReplace={() => { setReplacing(false); setNewKey(''); }}
        onChangeValue={setNewKey}
      />
      <label className="wall-editor__checkbox">
        <input
          type="checkbox"
          data-testid="settings-integrations-auto-import"
          checked={autoImport}
          onChange={(e) => setAutoImport(e.target.checked)}
        />
        Auto-import beers the Kegtron device reports (Kegtron-first library)
      </label>
      {error && (
        <p className="beer-form__notice" role="alert" data-testid="settings-integrations-govee-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="beer-form__submit"
        disabled={!dirty || submitting}
        data-testid="settings-integrations-govee-save"
      >
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}


/** Update-in-progress state machine — see the block comment in `SystemGroup`. */
type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'triggering' }
  | { phase: 'waiting'; startedVersion: string; deadline: number }
  | { phase: 'success'; newVersion: string }
  | { phase: 'timedOut' }
  | { phase: 'failed'; message: string };

const UPDATE_POLL_MS = 3_000;

/** Human labels for the native updater's phase file (kegwall-update.sh writes
 * fetching/installing/building/restarting; anything else falls back to generic). */
const UPDATE_PHASE_LABELS: Record<string, string> = {
  fetching: 'downloading the release',
  installing: 'installing dependencies (the long step)',
  building: 'building the interface',
  restarting: 'restarting the server',
};
const UPDATE_DEADLINE_MS = 5 * 60_000;

/**
 * Settings → System: the in-app update card. One form holds both the update-mode
 * config (off / Watchtower / native — see routes/system.ts for what each does) and
 * the check/apply actions, so the "don't update while the config draft is dirty"
 * gate needs no cross-component plumbing.
 *
 * The apply flow is an inline two-step confirm (click → "Confirm — restarts
 * briefly" → click), deliberately NOT BackupPanel's typed-word gate: restore
 * destroys data irreversibly and earned that friction; an update is non-destructive.
 * After a 202 the server is expected to DIE mid-update, so progress is watched by
 * polling the version endpoint raw (`pollSystemVersion` — request()'s 401 redirect
 * would eject the admin mid-restart) until the reported version CHANGES, with a
 * 5-minute deadline. A page reload during the wait intentionally forgets the state —
 * the admin just sees the new version in the sidebar footer.
 */
function SystemGroup({ settings, onSaved }: GroupProps) {
  const cfg = settings.updates;
  const [mode, setMode] = useState<'off' | 'watchtower' | 'native'>(cfg?.mode ?? 'off');
  const [url, setUrl] = useState(cfg?.watchtowerUrl ?? '');
  const [replacing, setReplacing] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<{ state: 'idle' } | { state: 'running' } | { state: 'done'; result: UpdateCheck }>({ state: 'idle' });
  const [update, setUpdate] = useState<UpdatePhase>({ phase: 'idle' });
  // The native updater's current phase (update-status file), shown inside the
  // updating banner; null = no info (watchtower, restart window).
  const [updatePhaseDetail, setUpdatePhaseDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSystemVersion().then((result) => {
      if (!cancelled && result.ok) setVersion(result.data.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The waiting poller: every 3s, raw-fetch the version; null (server down mid-swap)
  // is expected and ignored; a CHANGED version is success; the deadline trips the
  // timed-out warning. Alongside it, the native updater's phase file
  // (GET /api/system/update-status) feeds the live progress line — null there just
  // means "no phase info" (watchtower mode, restart window, older installer).
  useEffect(() => {
    if (update.phase !== 'waiting') return undefined;
    const timer = setInterval(() => {
      void pollUpdateStatus().then((phase) => {
        setUpdatePhaseDetail(phase);
      });
      void pollSystemVersion().then((v) => {
        setUpdate((u) => {
          if (u.phase !== 'waiting') return u;
          if (v && v !== u.startedVersion) {
            setVersion(v);
            return { phase: 'success', newVersion: v };
          }
          if (Date.now() > u.deadline) return { phase: 'timedOut' };
          return u;
        });
      });
    }, UPDATE_POLL_MS);
    return () => clearInterval(timer);
  }, [update.phase]);

  const dirty = mode !== (cfg?.mode ?? 'off')
    || (mode === 'watchtower' && url.trim() !== (cfg?.watchtowerUrl ?? ''))
    || (replacing && newToken.trim() !== '');
  const busy = update.phase === 'triggering' || update.phase === 'waiting';
  const savedMode = cfg?.mode ?? 'off';
  const canUpdate = savedMode !== 'off' && !dirty && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {
      updates: mode === 'off' ? { mode } : {
        mode,
        ...(mode === 'watchtower' ? {
          watchtowerUrl: url.trim() || undefined,
          // A still-masked token round-trips through sanitizePatch's swap-back.
          watchtowerToken: replacing && newToken.trim() !== '' ? newToken.trim() : cfg?.watchtowerToken,
        } : {}),
      },
    };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReplacing(false);
    setNewToken('');
    onSaved(result.data, patch);
  }

  async function runCheck() {
    setCheck({ state: 'running' });
    const result = await checkForUpdates();
    setCheck({
      state: 'done',
      result: result.ok ? result.data : { ok: false, current: version ?? '?', message: result.message },
    });
  }

  async function runUpdate() {
    setUpdatePhaseDetail(null);
    setUpdate({ phase: 'triggering' });
    const startedVersion = version ?? '0.0.0';
    const result = await triggerUpdate(
      check.state === 'done' && check.result.ok ? check.result.latest : undefined,
    );
    if (!result.ok) {
      setUpdate({ phase: 'failed', message: result.message });
      return;
    }
    setUpdate({ phase: 'waiting', startedVersion, deadline: Date.now() + UPDATE_DEADLINE_MS });
  }

  return (
    <section className="settings-group" data-testid="settings-group-system">
      <h2 className="settings-group__title font-display">System</h2>

      <form className="channels-group__block" data-testid="settings-system-updates" onSubmit={handleSubmit}>
        <h3 className="channels-group__block-title">Software update</h3>
        <p className="admin-page-quiet">
          Current version: <span className="font-tabular" data-testid="settings-system-version">{version ? `v${version}` : '…'}</span>
        </p>
        <label className="admin-field">
          <span>Update mode</span>
          <select
            data-testid="settings-system-mode"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as 'off' | 'watchtower' | 'native')}
          >
            <option value="off">Off (update manually)</option>
            <option value="watchtower">Docker — Watchtower sidecar</option>
            <option value="native">Bare metal — Pi installer</option>
          </select>
        </label>
        {mode === 'watchtower' && (
          <>
            <label className="admin-field">
              <span>Watchtower URL</span>
              <input
                type="text"
                data-testid="settings-system-watchtower-url"
                placeholder="http://127.0.0.1:8090"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <MaskedSecretField
              label="Watchtower API token (must match WATCHTOWER_HTTP_API_TOKEN in your compose file)"
              testId="settings-system-watchtower-token"
              maskedValue={cfg?.watchtowerToken}
              replacing={replacing}
              value={newToken}
              onStartReplace={() => { setReplacing(true); setNewToken(''); }}
              onCancelReplace={() => { setReplacing(false); setNewToken(''); }}
              onChangeValue={setNewToken}
            />
          </>
        )}
        {mode === 'native' && (
          <p className="admin-page-quiet">
            Requires the Pi installer&rsquo;s updater units (scripts/pi-install.sh) — the
            update runs in the background and restarts the server when done.
          </p>
        )}
        {error && (
          <p className="beer-form__notice" role="alert" data-testid="settings-system-error">{error}</p>
        )}
        <button
          type="submit"
          className="beer-form__submit"
          disabled={!dirty || submitting || busy}
          data-testid="settings-system-save"
        >
          {submitting ? 'Saving…' : 'Save changes'}
        </button>

        <h3 className="channels-group__block-title">Check &amp; apply</h3>
        <div className="settings-actions">
          <button
            type="button"
            data-testid="settings-system-check"
            disabled={check.state === 'running' || busy}
            onClick={runCheck}
          >
            {check.state === 'running' ? 'Checking…' : 'Check for updates'}
          </button>
          {update.phase === 'confirming' ? (
            <button
              type="button"
              data-testid="settings-system-update-confirm"
              onClick={runUpdate}
            >
              Confirm — server will restart briefly
            </button>
          ) : (
            <button
              type="button"
              data-testid="settings-system-update"
              disabled={!canUpdate}
              onClick={() => setUpdate({ phase: 'confirming' })}
            >
              Update now
            </button>
          )}
        </div>
        {check.state === 'done' && (
          <p className="admin-page-quiet" data-testid="settings-system-check-result">
            {check.result.ok
              ? check.result.updateAvailable
                ? (
                  <>
                    v{check.result.latest} available —{' '}
                    <a href={check.result.notesUrl} target="_blank" rel="noreferrer">Release notes ↗</a>
                  </>
                )
                : `Up to date (v${check.result.current})`
              : check.result.message}
          </p>
        )}
        {savedMode === 'off' && (
          <p className="admin-page-quiet" data-testid="settings-system-off-hint">
            Pick an update mode above (and save) to enable one-click updates.
          </p>
        )}
        {update.phase === 'waiting' && (
          <p className="beer-form__notice" data-testid="settings-system-updating">
            {updatePhaseDetail?.startsWith('failed')
              ? `Update ${updatePhaseDetail}`
              : `Updating — ${UPDATE_PHASE_LABELS[updatePhaseDetail ?? ''] ?? 'working in the background'}…
                 This can take a few minutes on a Pi. Don’t close the tab.`}
          </p>
        )}
        {update.phase === 'success' && (
          <p className="admin-page-quiet" data-testid="settings-system-updated">
            Updated to v{update.newVersion} ✓
          </p>
        )}
        {update.phase === 'timedOut' && (
          <p className="beer-form__notice" role="alert" data-testid="settings-system-update-timeout">
            The update didn&rsquo;t finish within 5 minutes — it may still be in progress.
            Check the Connection doctor or your container/journal logs. (Native mode
            requires the Pi installer&rsquo;s updater units.)
          </p>
        )}
        {update.phase === 'failed' && (
          <p className="beer-form__notice" role="alert" data-testid="settings-system-update-error">
            {update.message}
          </p>
        )}
      </form>

      {/* OS updates — NATIVE installs only (the trigger-file units only exist there);
          Docker/watchtower admins never see this block. Gated on the SAVED mode so
          merely flipping the select above doesn't flash it in and out. */}
      {savedMode === 'native' && <OsUpdatesBlock settings={settings} onSaved={onSaved} />}
    </section>
  );
}

/** The "Operating system" block inside SystemGroup: apt-update mode (off / manual /
 * unattended-upgrades) + auto-reboot, and the "Update OS now" trigger with an inline
 * two-step confirm (the software-update idiom above — NOT BackupPanel's typed-word
 * gate, which destructive restore alone has earned). */
function OsUpdatesBlock({ settings, onSaved }: GroupProps) {
  const cfg = settings.osUpdates;
  const [osMode, setOsMode] = useState<'off' | 'manual' | 'auto'>(cfg?.mode ?? 'off');
  const [autoReboot, setAutoReboot] = useState(cfg?.autoReboot ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<
    { state: 'idle' } | { state: 'confirming' } | { state: 'started'; message: string } | { state: 'failed'; message: string }
  >({ state: 'idle' });

  const savedOsMode = cfg?.mode ?? 'off';
  const dirty = osMode !== savedOsMode || autoReboot !== (cfg?.autoReboot ?? false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = { osUpdates: { mode: osMode, autoReboot } };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  async function runOsUpdate() {
    const result = await triggerOsUpdate();
    setRun(result.ok
      ? { state: 'started', message: result.data.message }
      : { state: 'failed', message: result.message });
  }

  return (
    <form className="channels-group__block" data-testid="settings-system-os" onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">Operating system</h3>
      <p className="admin-page-quiet">
        Keeps Raspberry Pi OS itself (apt packages, security fixes) updated — separate
        from Kegwall updates above.
      </p>
      <label className="admin-field">
        <span>OS updates</span>
        <select
          data-testid="settings-system-os-mode"
          value={osMode}
          onChange={(e) => setOsMode(e.target.value as 'off' | 'manual' | 'auto')}
        >
          <option value="off">Off</option>
          <option value="manual">Manual — update from here</option>
          <option value="auto">Automatic — unattended-upgrades</option>
        </select>
      </label>
      {osMode === 'auto' && (
        <p className="admin-page-quiet" data-testid="settings-system-os-auto-hint">
          Automatic mode relies on unattended-upgrades set up by the Pi installer —
          re-run scripts/pi-install.sh (or see the Raspberry Pi docs) if it wasn&rsquo;t
          enabled at install time.
        </p>
      )}
      <label className="settings-toggle">
        <input
          type="checkbox"
          data-testid="settings-system-os-autoreboot"
          checked={autoReboot}
          onChange={(e) => setAutoReboot(e.target.checked)}
        />
        <span>Reboot automatically when an update requires it</span>
      </label>
      {error && (
        <p className="beer-form__notice" role="alert" data-testid="settings-system-os-error">{error}</p>
      )}
      <button
        type="submit"
        className="beer-form__submit"
        disabled={!dirty || submitting}
        data-testid="settings-system-os-save"
      >
        {submitting ? 'Saving…' : 'Save changes'}
      </button>

      <div className="settings-actions">
        {run.state === 'confirming' ? (
          <button
            type="button"
            data-testid="settings-system-os-update-confirm"
            onClick={runOsUpdate}
          >
            Confirm — apt runs in the background; if a reboot is needed and auto-reboot
            is on, the Pi reboots immediately and the wall goes dark for ~1–2 minutes
          </button>
        ) : (
          <button
            type="button"
            data-testid="settings-system-os-update"
            disabled={savedOsMode === 'off' || dirty}
            onClick={() => setRun({ state: 'confirming' })}
          >
            Update OS now
          </button>
        )}
      </div>
      {run.state === 'started' && (
        <p className="admin-page-quiet" data-testid="settings-system-os-started">{run.message}</p>
      )}
      {run.state === 'failed' && (
        <p className="beer-form__notice" role="alert" data-testid="settings-system-os-run-error">
          {run.message}
        </p>
      )}
    </form>
  );
}

interface IntegrationsGroupProps {
  settings: Settings;
  /** For the HA block only — routes to the SHARED `mqtt` version counter (same as
   * SourcesGroup) since HA's fields live inside `mqtt`. */
  onSaved: (updated: Settings, patch: Partial<Settings>) => void;
  /** For the CatalogBeerBlock only — routes to its OWN version counter, deliberately
   * separate from `onSaved` above: `catalogBeer` shares nothing with `mqtt`, so bumping
   * the shared mqtt-version counter on a catalog.beer-only save would needlessly remount
   * (and discard any unsaved draft in) the SIBLING SourcesGroup too. See
   * SettingsPage's `catalogBeerVersion`. */
  onCatalogBeerSaved: (updated: Settings, patch: Partial<Settings>) => void;
}

/** Integrations group (Task 8; Untappd creds removed post-v0.1.0 — Untappd stopped
 * granting new developer API credentials, so the integration was removed entirely, see
 * CHANGELOG): Home Assistant publish/discovery-prefix, plus (Wave N) the optional
 * catalog.beer search API key — two fully independent blocks, each with its own form and
 * Save button, same "outer `<section>`, independent `<form>` blocks inside" shape as
 * ChannelsGroup below. */
function IntegrationsGroup({ settings, onSaved, onCatalogBeerSaved }: IntegrationsGroupProps) {
  return (
    <section className="settings-group" data-testid="settings-group-integrations" aria-labelledby="settings-integrations-title">
      <h2 id="settings-integrations-title" className="admin-field__label-text">Integrations</h2>
      <HomeAssistantBlock settings={settings} onSaved={onSaved} />
      <CatalogBeerBlock settings={settings} onSaved={onCatalogBeerSaved} />
      <GoveeBlock settings={settings} onSaved={onCatalogBeerSaved} />
    </section>
  );
}

type AlertChannels = Settings['alertChannels'];

interface ChannelBlockProps {
  alertChannels: AlertChannels;
  /** Same `(updated, patch)` shape as `GroupProps.onSaved` — bubbles the fresh canonical
   * settings up (so a sibling block mid-edit sees the other channels' latest values on
   * ITS next own save) plus the exact patch sent (for the page's saved/restart notice). */
  onSaved: (updated: Settings, patch: Partial<Settings>) => void;
}

/**
 * The "Send test" affordance shared by every channel block (Task 2's
 * `POST /api/channels/:name/test`) — sends against whatever is CURRENTLY SAVED (not this
 * block's own unsaved draft; the server tests real stored config), and shows the result
 * inline. Its own local `testing`/`result` state is independent per channel (one instance
 * per block), so testing one channel never disturbs another's result.
 */
function SendTestButton({ name }: { name: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const res = await testChannel(name);
    setTesting(false);
    setResult(res.ok ? res.data : { ok: false, message: res.message });
  }

  return (
    <div className="channels-group__test">
      <button
        type="button"
        data-testid={`settings-channels-${name}-test`}
        disabled={testing}
        onClick={handleTest}
      >
        {testing ? 'Sending…' : 'Send test'}
      </button>
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          data-testid={`settings-channels-${name}-test-result`}
          className="channels-group__test-result"
          data-ok={result.ok}
        >
          {result.ok ? 'Test message sent successfully.' : (result.message || 'Test failed.')}
        </p>
      )}
    </div>
  );
}

/** ntfy (Task 2/6): server URL + topic, neither a secret — no masking needed. */
function NtfyBlock({ alertChannels, onSaved }: ChannelBlockProps) {
  const cfg = alertChannels.ntfy;
  const [serverUrl, setServerUrl] = useState(cfg?.serverUrl ?? '');
  const [topic, setTopic] = useState(cfg?.topic ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = serverUrl !== (cfg?.serverUrl ?? '') || topic !== (cfg?.topic ?? '');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (!serverUrl.trim() || !topic.trim()) {
      setError('Server URL and topic are both required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {
      alertChannels: { ...alertChannels, ntfy: { serverUrl: serverUrl.trim(), topic: topic.trim() } },
    };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form className="channels-group__block" data-testid="settings-channels-ntfy" onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">ntfy</h3>
      <div className="settings-group__grid">
        <label className="admin-field">
          <span>Server URL</span>
          <input
            type="text" data-testid="settings-channels-ntfy-server-url"
            value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Topic</span>
          <input
            type="text" data-testid="settings-channels-ntfy-topic"
            value={topic} onChange={(e) => setTopic(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-channels-ntfy-error">{error}</p>}
      <div className="channels-group__block-actions">
        <button
          type="submit" className="beer-form__submit" data-testid="settings-channels-ntfy-save"
          disabled={!dirty || submitting}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <SendTestButton name="ntfy" />
      </div>
    </form>
  );
}

/** Pushover: `token` is the secret (masked, Replace affordance); `user` is not. */
function PushoverBlock({ alertChannels, onSaved }: ChannelBlockProps) {
  const cfg = alertChannels.pushover;
  const [user, setUser] = useState(cfg?.user ?? '');
  const [replacing, setReplacing] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = user !== (cfg?.user ?? '') || (replacing && newToken.trim() !== '');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const token = replacing && newToken.trim() ? newToken.trim() : cfg?.token;
    if (!user.trim() || !token) {
      setError('A Pushover user key and app token are both required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {
      alertChannels: { ...alertChannels, pushover: { token, user: user.trim() } },
    };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReplacing(false);
    setNewToken('');
    onSaved(result.data, patch);
  }

  return (
    <form className="channels-group__block" data-testid="settings-channels-pushover" onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">Pushover</h3>
      <div className="settings-group__grid">
        <label className="admin-field">
          <span>User key</span>
          <input
            type="text" data-testid="settings-channels-pushover-user"
            value={user} onChange={(e) => setUser(e.target.value)}
          />
        </label>
      </div>
      <MaskedSecretField
        label="App token"
        testId="settings-channels-pushover-token"
        maskedValue={cfg?.token}
        replacing={replacing}
        value={newToken}
        onStartReplace={() => { setReplacing(true); setNewToken(''); }}
        onCancelReplace={() => { setReplacing(false); setNewToken(''); }}
        onChangeValue={setNewToken}
      />
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-channels-pushover-error">{error}</p>}
      <div className="channels-group__block-actions">
        <button
          type="submit" className="beer-form__submit" data-testid="settings-channels-pushover-save"
          disabled={!dirty || submitting}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <SendTestButton name="pushover" />
      </div>
    </form>
  );
}

/** SMTP: `password` is the only secret; every other field is plain config. */
function SmtpBlock({ alertChannels, onSaved }: ChannelBlockProps) {
  const cfg = alertChannels.smtp;
  const [host, setHost] = useState(cfg?.host ?? '');
  const [port, setPort] = useState(String(cfg?.port ?? 587));
  const [secure, setSecure] = useState(cfg?.secure ?? false);
  const [user, setUser] = useState(cfg?.user ?? '');
  const [from, setFrom] = useState(cfg?.from ?? '');
  const [to, setTo] = useState(cfg?.to ?? '');
  const [replacing, setReplacing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = host !== (cfg?.host ?? '')
    || port !== String(cfg?.port ?? 587)
    || secure !== (cfg?.secure ?? false)
    || user !== (cfg?.user ?? '')
    || from !== (cfg?.from ?? '')
    || to !== (cfg?.to ?? '')
    || (replacing && newPassword.trim() !== '');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const portNum = Number(port);
    if (!host.trim() || !Number.isInteger(portNum) || portNum <= 0 || !from.trim() || !to.trim()) {
      setError('Host, a valid port, from, and to are all required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {
      alertChannels: {
        ...alertChannels,
        smtp: {
          host: host.trim(),
          port: portNum,
          secure,
          user: user.trim() || undefined,
          password: replacing && newPassword.trim() ? newPassword.trim() : cfg?.password,
          from: from.trim(),
          to: to.trim(),
        },
      },
    };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReplacing(false);
    setNewPassword('');
    onSaved(result.data, patch);
  }

  return (
    <form className="channels-group__block" data-testid="settings-channels-smtp" onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">Email (SMTP)</h3>
      <div className="settings-group__grid">
        <label className="admin-field">
          <span>Host</span>
          <input type="text" data-testid="settings-channels-smtp-host" value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="admin-field">
          <span>Port</span>
          <input
            type="text" inputMode="numeric" data-testid="settings-channels-smtp-port"
            value={port} onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Username</span>
          <input type="text" data-testid="settings-channels-smtp-user" value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="admin-field">
          <span>From address</span>
          <input type="text" data-testid="settings-channels-smtp-from" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="admin-field">
          <span>To address</span>
          <input type="text" data-testid="settings-channels-smtp-to" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <label className="settings-toggle">
        <input
          type="checkbox" data-testid="settings-channels-smtp-secure"
          checked={secure} onChange={(e) => setSecure(e.target.checked)}
        />
        <span>Use TLS (secure)</span>
      </label>
      <MaskedSecretField
        label="Password"
        testId="settings-channels-smtp-password"
        maskedValue={cfg?.password}
        replacing={replacing}
        value={newPassword}
        onStartReplace={() => { setReplacing(true); setNewPassword(''); }}
        onCancelReplace={() => { setReplacing(false); setNewPassword(''); }}
        onChangeValue={setNewPassword}
      />
      {error && <p className="beer-form__notice" role="alert" data-testid="settings-channels-smtp-error">{error}</p>}
      <div className="channels-group__block-actions">
        <button
          type="submit" className="beer-form__submit" data-testid="settings-channels-smtp-save"
          disabled={!dirty || submitting}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <SendTestButton name="smtp" />
      </div>
    </form>
  );
}

/** Discord/Slack: a single field, `webhookUrl` — the URL itself IS the credential (an
 * unguessable token lives in its path), so the whole field is masked as origin + '/…'
 * (see `db/settings.ts`'s `maskWebhookUrl`). One component, parameterized by `name`. */
function WebhookChannelBlock({ name, label, alertChannels, onSaved }: ChannelBlockProps & {
  name: 'discord' | 'slack';
  label: string;
}) {
  const cfg = alertChannels[name];
  const [replacing, setReplacing] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = replacing && newUrl.trim() !== '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {
      alertChannels: { ...alertChannels, [name]: { webhookUrl: newUrl.trim() } },
    };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReplacing(false);
    setNewUrl('');
    onSaved(result.data, patch);
  }

  return (
    <form className="channels-group__block" data-testid={`settings-channels-${name}`} onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">{label}</h3>
      <MaskedSecretField
        label="Webhook URL"
        testId={`settings-channels-${name}-webhook`}
        maskedValue={cfg?.webhookUrl}
        replacing={replacing}
        value={newUrl}
        onStartReplace={() => { setReplacing(true); setNewUrl(''); }}
        onCancelReplace={() => { setReplacing(false); setNewUrl(''); }}
        onChangeValue={setNewUrl}
      />
      {error && (
        <p className="beer-form__notice" role="alert" data-testid={`settings-channels-${name}-error`}>{error}</p>
      )}
      <div className="channels-group__block-actions">
        <button
          type="submit" className="beer-form__submit" data-testid={`settings-channels-${name}-save`}
          disabled={!dirty || submitting}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <SendTestButton name={name} />
      </div>
    </form>
  );
}

/**
 * Channels group (Task 6): the automation engine's `notify` action senders (Task 2) —
 * ntfy, Pushover, SMTP, Discord, Slack — each an independent block with its own Save +
 * "Send test" button, matching the design direction's masked-secret-with-Replace
 * precedent. Every block spreads `alertChannels` before setting its own key (same
 * "shared-key PATCH round-trips the whole object" idiom as `SourcesGroup`/
 * `IntegrationsGroup`'s `mqtt` field) so saving one channel never touches another's
 * already-configured value — see the isolation test in SettingsPage.test.tsx. Unlike
 * Sources/Integrations (two SEPARATE sibling components sharing one settings key, which
 * DO need the page-level remount-via-`key` trick to resync a stale sibling draft), every
 * block here lives in the SAME component tree and reads `alertChannels` straight from
 * fresh props on every render — no remount needed; each block resets its own local
 * "replacing"/draft state directly after its own successful save instead.
 */
function ChannelsGroup({ settings, onSaved }: GroupProps) {
  return (
    <section className="settings-group" data-testid="settings-group-channels" aria-labelledby="settings-channels-title">
      <h2 id="settings-channels-title" className="admin-field__label-text">Channels</h2>
      <p className="admin-page-quiet">
        Delivery channels for the automation engine&rsquo;s notify actions and alerts.
      </p>
      <NtfyBlock alertChannels={settings.alertChannels} onSaved={onSaved} />
      <PushoverBlock alertChannels={settings.alertChannels} onSaved={onSaved} />
      <SmtpBlock alertChannels={settings.alertChannels} onSaved={onSaved} />
      <WebhookChannelBlock name="discord" label="Discord" alertChannels={settings.alertChannels} onSaved={onSaved} />
      <WebhookChannelBlock name="slack" label="Slack" alertChannels={settings.alertChannels} onSaved={onSaved} />
    </section>
  );
}

type PageStatus = 'loading' | 'loaded' | 'error';

type GroupId = 'site' | 'kegtron' | 'mqtt' | 'catalogBeer' | 'channels' | 'updates';

/**
 * `/admin/settings` (Task 8, admin-only route — same "no role branching needed" situation
 * as UsersPage; `AdminLayout` already bounces any non-admin). Four independent groups
 * (Site, Kegtron, Sources, Integrations) each PATCH only their own changed keys, plus a
 * Backup group (`BackupPanel`) for download/restore.
 *
 * Sources and Integrations both edit sub-fields of the same `mqtt` settings key (see
 * SourcesGroup's doc comment) — after EITHER saves, the OTHER must re-derive its local
 * draft from the fresh canonical `mqtt`, or its next save would silently resend a stale
 * copy of the sibling's fields and revert them. That's what `mqttVersion` (remounting
 * both, via their `key` props) is for. Site and Kegtron own fully independent keys, so
 * they each get their OWN version counter that bumps ONLY on their own save — an admin
 * mid-edit on the Site form doesn't lose that draft just because they saved Sources first.
 *
 * `catalogBeerVersion` follows that same "own independent key, own counter" precedent for
 * Integrations' `CatalogBeerBlock` — it must NOT share `mqttVersion` (that would remount,
 * and so discard any unsaved draft in, the SIBLING SourcesGroup on every catalog.beer
 * save, even though catalog.beer shares nothing with `mqtt`).
 */
export function SettingsPage() {
  const [status, setStatus] = useState<PageStatus>('loading');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [siteVersion, setSiteVersion] = useState(0);
  const [kegtronVersion, setKegtronVersion] = useState(0);
  const [mqttVersion, setMqttVersion] = useState(0);
  const [catalogBeerVersion, setCatalogBeerVersion] = useState(0);
  const [updatesVersion, setUpdatesVersion] = useState(0);
  const [notice, setNotice] = useState<'saved' | 'restarted' | null>(null);

  const load = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    getSettings().then((result) => {
      if (result.ok) {
        setSettings(result.data);
        setStatus('loaded');
        setSiteVersion((v) => v + 1);
        setKegtronVersion((v) => v + 1);
        setMqttVersion((v) => v + 1);
        setCatalogBeerVersion((v) => v + 1);
        setUpdatesVersion((v) => v + 1);
      } else {
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleGroupSaved(group: GroupId, updated: Settings, patch: Partial<Settings>) {
    setSettings(updated);
    if (group === 'site') setSiteVersion((v) => v + 1);
    else if (group === 'updates') setUpdatesVersion((v) => v + 1);
    else if (group === 'kegtron') setKegtronVersion((v) => v + 1);
    else if (group === 'mqtt') setMqttVersion((v) => v + 1);
    else if (group === 'catalogBeer') setCatalogBeerVersion((v) => v + 1);
    // 'channels': no version bump/remount — see ChannelsGroup's doc comment for why each
    // of its 5 blocks manages its own post-save local-state reset instead.
    setNotice(triggersRestart(patch) ? 'restarted' : 'saved');
  }

  if (status === 'loading') {
    return <p className="admin-page-quiet" data-testid="settings-loading">Loading…</p>;
  }
  if (status === 'error' || !settings) {
    return (
      <p className="admin-page-quiet" role="alert" data-testid="settings-error">
        Couldn&rsquo;t load settings. Reload to try again.
      </p>
    );
  }

  return (
    <section data-testid="admin-settings-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Settings</h1>
        <a className="admin-page-quiet" href="/admin/doctor" data-testid="settings-doctor-link">
          Connection doctor →
        </a>
      </header>

      {notice === 'restarted' && (
        <p className="settings-notice settings-notice--restart" role="status" data-testid="settings-restart-notice">
          Sources restarted to apply changes.
        </p>
      )}
      {notice === 'saved' && (
        <p className="settings-notice" role="status" data-testid="settings-saved-notice">
          Saved.
        </p>
      )}

      <div className="settings-groups">
        <SiteGroup
          key={`site-${siteVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('site', updated, patch)}
        />
        <KegtronGroup
          key={`kegtron-${kegtronVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('kegtron', updated, patch)}
        />
        <SourcesGroup
          key={`sources-${mqttVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('mqtt', updated, patch)}
        />
        <IntegrationsGroup
          key={`integrations-${mqttVersion}-${catalogBeerVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('mqtt', updated, patch)}
          onCatalogBeerSaved={(updated, patch) => handleGroupSaved('catalogBeer', updated, patch)}
        />
        <ChannelsGroup
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('channels', updated, patch)}
        />
        <SystemGroup
          key={`system-${updatesVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('updates', updated, patch)}
        />
        <BackupPanel />
      </div>
    </section>
  );
}
