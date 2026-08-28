import { useState, type FormEvent } from 'react';
import type { Settings } from '../../../../server/db/settings.js';
import { patchSettings } from '../../../lib/adminApi';
import { MQTT_DEFAULTS, type GroupProps } from './shared';
import { MaskedSecretField } from './MaskedSecretField';

/** Sources group (Task 8): UDP toggle (+ LAN note), BLE toggle, and MQTT url/user/pass/
 * prefix. `mqtt` is ONE settings key shared with the Integrations group's HA fields below
 * — saving here always sends the FULL current mqtt object (this group's own edits merged
 * over whatever Integrations' fields currently are, from `settings.mqtt`), so a Sources
 * save never clobbers an HA publish toggle/discovery prefix Integrations already set, and
 * vice versa. An untouched password re-sends its masked display value, which the server's
 * `sanitizePatch` swaps back for the real stored one (never a literal new secret). */
export function SourcesGroup({ settings, onSaved }: GroupProps) {
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
      // Displays & Presence hub Task 5: `motionTopics` is deliberately OMITTED from this
      // patch (not sent as `[]`, not passed through) — the motion-topics repeater that
      // used to live here is gone; the `motionSources` registry (see PresencePage.tsx's
      // Sources panel) owns motion configuration now. The key stays in `settingsSchema`
      // purely so `core/motionSources.ts`'s boot-time `migrateMotionTopics` can still read
      // and clear a pre-upgrade value — by the time any admin can reach THIS form, that
      // migration has already run and left `mqtt.motionTopics` at its schema default
      // (`[]`), so omitting it here and letting the server's own `.default([])` apply is
      // exactly equivalent to sending `[]` explicitly, without this form needing to know
      // or care what the stored value is. `patch.mqtt`'s cast is required because
      // `Settings['mqtt']` (via `z.infer`) treats every `.default()` sub-field, including
      // `motionTopics`, as REQUIRED on the output type — TypeScript has no way to know the
      // server fills it in when absent from the wire payload.
      patch.mqtt = {
        url: mqttUrl.trim(),
        username: mqttUsername.trim() || undefined,
        password: passwordReplacing && newPassword.trim() ? newPassword.trim() : mqtt?.password,
        gen1TopicPrefix: mqttPrefix.trim() || MQTT_DEFAULTS.gen1TopicPrefix,
        haPublishEnabled: mqtt?.haPublishEnabled ?? MQTT_DEFAULTS.haPublishEnabled,
        haDiscoveryPrefix: mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix,
        appTopicPrefix: mqtt?.appTopicPrefix ?? MQTT_DEFAULTS.appTopicPrefix,
      } as Settings['mqtt'];
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
