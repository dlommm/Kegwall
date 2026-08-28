import { useState } from 'react';
import type { Settings } from '../../../../server/db/settings.js';
import { MQTT_DEFAULTS, type GroupProps } from './shared';
import { MaskedSecretField, useMaskedSecret } from './MaskedSecretField';
import { useSettingsGroupForm } from './useSettingsGroupForm';

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

  const dirty = haPublishEnabled !== (mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled)
    || haDiscoveryPrefix !== (mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix);

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      if (!mqtt?.url) {
        return 'Configure an MQTT broker URL in the Sources group first — Home Assistant publishing goes out over MQTT.';
      }
      return {
        mqtt: {
          ...mqtt,
          haPublishEnabled,
          haDiscoveryPrefix: haDiscoveryPrefix.trim() || MQTT_DEFAULTS.haDiscoveryPrefix,
        },
      };
    },
  });

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
  const apiKey = useMaskedSecret();

  const dirty = apiKey.dirty;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    // `!`: the hook only submits while dirty, and this block's ONLY dirty term is a
    // freshly typed key — `newValue` is defined on every reachable path.
    buildPatch: () => ({ catalogBeer: { apiKey: apiKey.newValue! } }),
    onSuccess: apiKey.reset,
  });

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
        {...apiKey.fieldProps}
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
  const apiKey = useMaskedSecret();
  const [autoImport, setAutoImport] = useState(settings.autoImportBeers);

  const dirty = apiKey.dirty || autoImport !== settings.autoImportBeers;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      const patch: Partial<Settings> = {};
      if (apiKey.newValue !== undefined) {
        patch.govee = { apiKey: apiKey.newValue };
      }
      if (autoImport !== settings.autoImportBeers) patch.autoImportBeers = autoImport;
      return patch;
    },
    onSuccess: apiKey.reset,
  });

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
        {...apiKey.fieldProps}
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

  const dirty = enabled !== cfg.enabled || threshold !== String(cfg.threshold);

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      const parsed = Number(threshold);
      if (!Number.isFinite(parsed) || parsed < 0.3 || parsed > 0.95) {
        return 'Match threshold must be between 0.3 and 0.95.';
      }
      return { faceSignIn: { enabled, threshold: parsed } };
    },
  });

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

/** Integrations group (Task 8; Untappd creds removed post-v0.1.0 — Untappd stopped
 * granting new developer API credentials, so the integration was removed entirely, see
 * CHANGELOG): Home Assistant publish/discovery-prefix, plus (Wave N) the optional
 * catalog.beer search API key, plus (Displays & Presence hub Task 5) a pointer card to
 * the Presence hub, plus (Task 9) the Face sign-in card — independent blocks, each with
 * its own form and Save button (`PresenceBlock` is the one exception — a static link, no
 * form), same "outer `<section>`, independent `<form>` blocks inside" shape as
 * ChannelsGroup below. */
export function IntegrationsGroup({
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
