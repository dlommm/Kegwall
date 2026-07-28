import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Settings } from '../../../server/db/settings.js';
// A real VALUE import (not type-only) of a server `core/` module — see that file's doc
// comment for why this is safe under tsconfig.web.json (a dependency-free module, only a
// type import of db/settings.ts) and why it replaces what used to be a hand-duplicated
// local copy of this same constant.
import { SOURCE_RESTART_KEYS } from '../../../server/core/restartKeys.js';
import { getSettings, patchSettings, uploadLabel } from '../../lib/adminApi';
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
  appTopicPrefix: 'kegtron-dashboard',
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
  const [mqttUrl, setMqttUrl] = useState(mqtt?.url ?? '');
  const [mqttUsername, setMqttUsername] = useState(mqtt?.username ?? '');
  const [mqttPrefix, setMqttPrefix] = useState(mqtt?.gen1TopicPrefix ?? MQTT_DEFAULTS.gen1TopicPrefix);
  const [passwordReplacing, setPasswordReplacing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const udpDirty = udpEnabled !== settings.udpEnabled;
  const bleDirty = bleDirectEnabled !== settings.bleDirectEnabled;
  const mqttDirty = mqttUrl !== (mqtt?.url ?? '')
    || mqttUsername !== (mqtt?.username ?? '')
    || mqttPrefix !== (mqtt?.gen1TopicPrefix ?? MQTT_DEFAULTS.gen1TopicPrefix)
    || (passwordReplacing && newPassword.trim() !== '');
  const dirty = udpDirty || bleDirty || mqttDirty;

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

/** Integrations group (Task 8): Untappd creds (masked) + Home Assistant publish toggle
 * and discovery prefix. The HA fields live inside the same `mqtt` settings key Sources
 * owns url/user/pass/prefix for — see SourcesGroup's doc comment for the shared-key merge
 * approach used here too. */
function IntegrationsGroup({ settings, onSaved }: GroupProps) {
  const mqtt = settings.mqtt;
  const untappd = settings.untappd;
  const [untappdClientId, setUntappdClientId] = useState(untappd?.clientId ?? '');
  const [secretReplacing, setSecretReplacing] = useState(false);
  const [newClientSecret, setNewClientSecret] = useState('');
  const [haPublishEnabled, setHaPublishEnabled] = useState(mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled);
  const [haDiscoveryPrefix, setHaDiscoveryPrefix] = useState(mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const untappdDirty = untappdClientId !== (untappd?.clientId ?? '')
    || (secretReplacing && newClientSecret.trim() !== '');
  const haDirty = haPublishEnabled !== (mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled)
    || haDiscoveryPrefix !== (mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix);
  const dirty = untappdDirty || haDirty;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (untappdDirty && !untappdClientId.trim()) {
      setError('An Untappd client ID is required to save Untappd settings.');
      return;
    }
    if (haDirty && !mqtt?.url) {
      setError('Configure an MQTT broker URL in the Sources group first — Home Assistant publishing goes out over MQTT.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = {};
    if (untappdDirty) {
      patch.untappd = {
        clientId: untappdClientId.trim(),
        clientSecret: secretReplacing && newClientSecret.trim()
          ? newClientSecret.trim()
          : (untappd?.clientSecret ?? ''),
      };
    }
    if (haDirty && mqtt) {
      patch.mqtt = {
        ...mqtt,
        haPublishEnabled,
        haDiscoveryPrefix: haDiscoveryPrefix.trim() || MQTT_DEFAULTS.haDiscoveryPrefix,
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
    <form className="settings-group" data-testid="settings-group-integrations" onSubmit={handleSubmit} aria-labelledby="settings-integrations-title">
      <h2 id="settings-integrations-title" className="admin-field__label-text">Integrations</h2>

      <div className="settings-group__grid">
        <label className="admin-field">
          <span>Untappd client ID</span>
          <input
            type="text"
            data-testid="settings-integrations-untappd-clientid"
            value={untappdClientId}
            onChange={(e) => setUntappdClientId(e.target.value)}
          />
        </label>
      </div>
      <MaskedSecretField
        label="Untappd client secret"
        testId="settings-integrations-untappd-secret"
        maskedValue={untappd?.clientSecret}
        replacing={secretReplacing}
        value={newClientSecret}
        onStartReplace={() => { setSecretReplacing(true); setNewClientSecret(''); }}
        onCancelReplace={() => { setSecretReplacing(false); setNewClientSecret(''); }}
        onChangeValue={setNewClientSecret}
      />

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

type PageStatus = 'loading' | 'loaded' | 'error';

type GroupId = 'site' | 'kegtron' | 'mqtt';

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
 */
export function SettingsPage() {
  const [status, setStatus] = useState<PageStatus>('loading');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [siteVersion, setSiteVersion] = useState(0);
  const [kegtronVersion, setKegtronVersion] = useState(0);
  const [mqttVersion, setMqttVersion] = useState(0);
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
    else if (group === 'kegtron') setKegtronVersion((v) => v + 1);
    else setMqttVersion((v) => v + 1);
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
          key={`integrations-${mqttVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('mqtt', updated, patch)}
        />
        <BackupPanel />
      </div>
    </section>
  );
}
