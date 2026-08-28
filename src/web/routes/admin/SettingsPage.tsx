import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Settings } from '../../../server/db/settings.js';
import { getSettings, patchSettings, testChannel } from '../../lib/adminApi';
import { BackupPanel } from './BackupPanel';
import { MQTT_DEFAULTS, triggersRestart, type GroupProps } from './settings/shared';
import { MaskedSecretField } from './settings/MaskedSecretField';
import { SiteGroup } from './settings/SiteGroup';
import { PricingGroup } from './settings/PricingGroup';
import { KegtronGroup } from './settings/KegtronGroup';
import { SourcesGroup } from './settings/SourcesGroup';
import { SystemGroup } from './settings/SystemGroup';

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
      <p className="admin-page-quiet">
        New to this? <a href="/admin/home-assistant" data-testid="settings-ha-wizard-link">Set up Home Assistant with the guided wizard</a>
        {' '}— it tests the broker connection for you. Or configure it by hand below.
      </p>
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


/** Presence pointer card (Displays & Presence hub Task 5; spec Part B): the webhook
 * token display/generate mechanics and "wake all screens" action that used to live here
 * (Task 12) MOVED to `/admin/presence`'s Webhook & agent panel (PresencePage.tsx), which
 * also now owns the motion-sources table and the display-power/zone panels — one page
 * for everything presence-related, per the spec's Goal 1, instead of a second editing
 * surface here that could drift out of sync with it. This card is just a pointer so an
 * admin who lands on Settings → Integrations out of habit still finds their way there;
 * it takes no props (nothing here reads or writes settings anymore). */
function PresenceBlock() {
  return (
    <div className="channels-group__block" data-testid="settings-integrations-presence">
      <h3 className="channels-group__block-title">Presence</h3>
      <p className="admin-page-quiet">
        Motion sources, the webhook token, and zone/display-power controls now live on
        the Displays &amp; Presence hub.
      </p>
      <a className="admin-page-quiet" href="/admin/presence" data-testid="presence-hub-link">
        Open Displays &amp; Presence →
      </a>
    </div>
  );
}

interface IntegrationsGroupProps {
  settings: Settings;
  /** Per-block remount keys — each block below is keyed by ITS OWN counter (bumped only
   * when that block's settings key was just persisted), so a save remounts only the
   * block whose canonical state actually changed. The old shape — one composite
   * `key` on the whole group — meant saving ANY one block remounted EVERY block,
   * silently discarding the siblings' unsaved drafts (a half-typed Govee key vanished
   * when Home Assistant was saved), defeating exactly what the per-counter design
   * exists to prevent (see SettingsPage's version-counter doc comment). */
  mqttVersion: number;
  catalogBeerVersion: number;
  goveeVersion: number;
  faceSignInVersion: number;
  /** For the HA block only — routes to the SHARED `mqtt` version counter (same as
   * SourcesGroup) since HA's fields live inside `mqtt`. */
  onSaved: (updated: Settings, patch: Partial<Settings>) => void;
  /** For the CatalogBeerBlock only — routes to its OWN version counter, deliberately
   * separate from `onSaved` above: `catalogBeer` shares nothing with `mqtt`, so bumping
   * the shared mqtt-version counter on a catalog.beer-only save would needlessly remount
   * (and discard any unsaved draft in) the SIBLING SourcesGroup too. See
   * SettingsPage's `catalogBeerVersion`. */
  onCatalogBeerSaved: (updated: Settings, patch: Partial<Settings>) => void;
  /** For GoveeBlock only — same "own independent key, own counter" precedent:
   * `govee`/`autoImportBeers` share nothing with `mqtt`, `catalogBeer`, or
   * `faceSignIn`, so a Govee save must bump ONLY its own counter (it used to be
   * miswired to `onCatalogBeerSaved`, remounting — and so discarding any unsaved
   * draft in — the sibling CatalogBeerBlock on every Govee save). See SettingsPage's
   * `goveeVersion`. */
  onGoveeSaved: (updated: Settings, patch: Partial<Settings>) => void;
  /** For FaceSignInBlock only (Task 9) — same "own independent key, own counter"
   * precedent again: `faceSignIn` shares nothing with `mqtt`/`catalogBeer`/
   * `presenceWebhookToken`. See SettingsPage's `faceSignInVersion`. */
  onFaceSignInSaved: (updated: Settings, patch: Partial<Settings>) => void;
}

/** Face sign-in card (Task 9, Plan B; same group as PresenceBlock above — both are small
 * global on/off + a couple of plain fields, no masking needed): `faceSignIn.enabled` gates
 * the tablet's face camera pipeline entirely (off = the tablet never starts it, and
 * `POST /api/public/faces` 403s — see routes/public.ts), and `faceSignIn.threshold` is the
 * cosine-similarity match threshold `matchFace` (lib/faceRecognition.ts) compares
 * candidates against. Both are plain fields — unlike every masked-secret block on this
 * page there's no Replace affordance, just an ordinary checkbox + number input saved
 * through the normal `patchSettings` path. Client-side clamps the range to match the
 * schema's own `min(0.3).max(0.95)` (db/settings.ts) so a typo gets a clear inline message
 * instead of a raw 400 from the server. */
function FaceSignInBlock({ settings, onSaved }: GroupProps) {
  const cfg = settings.faceSignIn;
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [threshold, setThreshold] = useState(String(cfg.threshold));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== cfg.enabled || threshold !== String(cfg.threshold);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed) || parsed < 0.3 || parsed > 0.95) {
      setError('Match threshold must be between 0.3 and 0.95.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const patch: Partial<Settings> = { faceSignIn: { enabled, threshold: parsed } };
    const result = await patchSettings(patch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data, patch);
  }

  return (
    <form
      className="channels-group__block"
      data-testid="settings-integrations-facesignin"
      onSubmit={handleSubmit}
      // The number input's min/max below are also real HTML constraints (nicer spinner/
      // mobile-keyboard behavior), but validation itself is JS-driven — same
      // clear-inline-message idiom as SiteGroup's serving-size check — rather than a
      // native browser popup, so `noValidate` keeps the submit handler (and its message)
      // in charge of an out-of-range value instead of the browser silently swallowing it.
      noValidate
    >
      <h3 className="channels-group__block-title">Face sign-in</h3>
      <p className="admin-page-quiet">
        Lets the tablet recognize a returning drinker&rsquo;s face and sign them in
        automatically. Off by default — nothing runs on the tablet until this is enabled.
      </p>
      <label className="settings-toggle">
        <input
          type="checkbox"
          data-testid="settings-integrations-facesignin-enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>Enable face sign-in</span>
      </label>
      <label className="admin-field">
        <span>Match threshold</span>
        <input
          type="number"
          step={0.05}
          min={0.3}
          max={0.95}
          data-testid="settings-integrations-facesignin-threshold"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>
      {error && (
        <p className="beer-form__notice" role="alert" data-testid="settings-integrations-facesignin-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="beer-form__submit"
        disabled={!dirty || submitting}
        data-testid="settings-integrations-facesignin-save"
      >
        {submitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

/** Integrations group (Task 8; Untappd creds removed post-v0.1.0 — Untappd stopped
 * granting new developer API credentials, so the integration was removed entirely, see
 * CHANGELOG): Home Assistant publish/discovery-prefix, plus (Wave N) the optional
 * catalog.beer search API key, plus (Displays & Presence hub Task 5) a pointer card to
 * the Presence hub, plus (Task 9) the Face sign-in card — independent blocks, each with
 * its own form and Save button (`PresenceBlock` is the one exception — a static link, no
 * form), same "outer `<section>`, independent `<form>` blocks inside" shape as
 * ChannelsGroup below. */
function IntegrationsGroup({
  settings, mqttVersion, catalogBeerVersion, goveeVersion, faceSignInVersion,
  onSaved, onCatalogBeerSaved, onGoveeSaved, onFaceSignInSaved,
}: IntegrationsGroupProps) {
  return (
    <section className="settings-group" data-testid="settings-group-integrations" aria-labelledby="settings-integrations-title">
      <h2 id="settings-integrations-title" className="admin-field__label-text">Integrations</h2>
      <HomeAssistantBlock key={`ha-${mqttVersion}`} settings={settings} onSaved={onSaved} />
      <CatalogBeerBlock key={`catalogbeer-${catalogBeerVersion}`} settings={settings} onSaved={onCatalogBeerSaved} />
      <GoveeBlock key={`govee-${goveeVersion}`} settings={settings} onSaved={onGoveeSaved} />
      <PresenceBlock />
      <FaceSignInBlock key={`facesignin-${faceSignInVersion}`} settings={settings} onSaved={onFaceSignInSaved} />
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

type GroupId = 'site' | 'kegtron' | 'mqtt' | 'catalogBeer' | 'govee' | 'faceSignIn' | 'channels' | 'updates' | 'pricing';

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
 *
 * `faceSignInVersion` (Task 9) is the same precedent once more for `FaceSignInBlock` —
 * `faceSignIn` shares nothing with `mqtt` or `catalogBeer` either.
 *
 * `goveeVersion` is the same precedent for `GoveeBlock` (`govee` + `autoImportBeers`,
 * both fully independent keys) — its save used to be miswired to bump
 * `catalogBeerVersion`, remounting the sibling CatalogBeerBlock instead of itself.
 *
 * There's no `presenceVersion` counter — `PresenceBlock` (Displays & Presence hub Task 5)
 * is a static pointer card now, nothing here for it to re-derive a draft from.
 */
type SettingsTabId = 'general' | 'sources' | 'integrations' | 'system';

/** How long the transient saved/restarted notice stays visible before auto-clearing. */
const NOTICE_CLEAR_MS = 4_000;

const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sources', label: 'Sources' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'system', label: 'System' },
];

/** Initial tab from ?tab=<id> — plain URLSearchParams (not useSearchParams) on
 * purpose: this page has no other router needs, and the param is written back via
 * history.replaceState so tab switches never create history entries to back-button
 * through. */
function initialTab(): SettingsTabId {
  const requested = new URLSearchParams(window.location.search).get('tab');
  return SETTINGS_TABS.some((t) => t.id === requested) ? requested as SettingsTabId : 'general';
}

export function SettingsPage() {
  const [status, setStatus] = useState<PageStatus>('loading');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<SettingsTabId>(initialTab);

  function selectTab(next: SettingsTabId) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }
  const [siteVersion, setSiteVersion] = useState(0);
  const [kegtronVersion, setKegtronVersion] = useState(0);
  const [mqttVersion, setMqttVersion] = useState(0);
  const [catalogBeerVersion, setCatalogBeerVersion] = useState(0);
  const [goveeVersion, setGoveeVersion] = useState(0);
  const [faceSignInVersion, setFaceSignInVersion] = useState(0);
  const [updatesVersion, setUpdatesVersion] = useState(0);
  const [pricingVersion, setPricingVersion] = useState(0);
  // Wrapped in an object — a FRESH one per save — so back-to-back saves of the same
  // kind still restart the auto-clear effect below (a plain string wouldn't change
  // identity, and the first save's timer would clear the second save's notice early).
  const [notice, setNotice] = useState<{ kind: 'saved' | 'restarted' } | null>(null);

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
        setGoveeVersion((v) => v + 1);
        setFaceSignInVersion((v) => v + 1);
        setUpdatesVersion((v) => v + 1);
        setPricingVersion((v) => v + 1);
      } else {
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The saved/restarted notice is transient feedback, not page state — without this it
  // read "Saved." forever. Auto-clear it (the same transient-confirmation idiom as
  // WallsPage's copy-link feedback), with the timer cancelled on unmount or when a
  // newer notice replaces it.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function handleGroupSaved(group: GroupId, updated: Settings, patch: Partial<Settings>) {
    setSettings(updated);
    if (group === 'site') setSiteVersion((v) => v + 1);
    else if (group === 'updates') setUpdatesVersion((v) => v + 1);
    else if (group === 'kegtron') setKegtronVersion((v) => v + 1);
    else if (group === 'mqtt') setMqttVersion((v) => v + 1);
    else if (group === 'catalogBeer') setCatalogBeerVersion((v) => v + 1);
    else if (group === 'govee') setGoveeVersion((v) => v + 1);
    else if (group === 'faceSignIn') setFaceSignInVersion((v) => v + 1);
    else if (group === 'pricing') setPricingVersion((v) => v + 1);
    // 'channels': no version bump/remount — see ChannelsGroup's doc comment for why each
    // of its 5 blocks manages its own post-save local-state reset instead.
    setNotice({ kind: triggersRestart(patch) ? 'restarted' : 'saved' });
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

      {notice?.kind === 'restarted' && (
        <p className="settings-notice settings-notice--restart" role="status" data-testid="settings-restart-notice">
          Sources restarted to apply changes.
        </p>
      )}
      {notice?.kind === 'saved' && (
        <p className="settings-notice" role="status" data-testid="settings-saved-notice">
          Saved.
        </p>
      )}

      {/* Tab bar — the page outgrew one long scroll. Every panel stays MOUNTED
          (inactive ones get the `hidden` attribute) so unsaved drafts survive tab
          switches and the version-counter remount keys keep their exact semantics;
          only visibility changes. ?tab=<id> deep-links (docs say "Settings →
          System" in a dozen places) without coupling this page to the router. */}
      <nav className="settings-tabs" role="tablist" aria-label="Settings sections" data-testid="settings-tabs">
        {SETTINGS_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`settings-tabs__tab${tab === id ? ' settings-tabs__tab--active' : ''}`}
            data-testid={`settings-tab-${id}`}
            onClick={() => selectTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="settings-groups" hidden={tab !== 'general'} data-testid="settings-panel-general">
        <SiteGroup
          key={`site-${siteVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('site', updated, patch)}
        />
        <PricingGroup
          key={`pricing-${pricingVersion}`}
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('pricing', updated, patch)}
        />
      </div>
      <div className="settings-groups" hidden={tab !== 'sources'} data-testid="settings-panel-sources">
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
      </div>
      <div className="settings-groups" hidden={tab !== 'integrations'} data-testid="settings-panel-integrations">
        <IntegrationsGroup
          settings={settings}
          mqttVersion={mqttVersion}
          catalogBeerVersion={catalogBeerVersion}
          goveeVersion={goveeVersion}
          faceSignInVersion={faceSignInVersion}
          onSaved={(updated, patch) => handleGroupSaved('mqtt', updated, patch)}
          onCatalogBeerSaved={(updated, patch) => handleGroupSaved('catalogBeer', updated, patch)}
          onGoveeSaved={(updated, patch) => handleGroupSaved('govee', updated, patch)}
          onFaceSignInSaved={(updated, patch) => handleGroupSaved('faceSignIn', updated, patch)}
        />
        <ChannelsGroup
          settings={settings}
          onSaved={(updated, patch) => handleGroupSaved('channels', updated, patch)}
        />
      </div>
      <div className="settings-groups" hidden={tab !== 'system'} data-testid="settings-panel-system">
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
