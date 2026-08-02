import { useState } from 'react';
import type { Settings } from '../../server/db/settings.js';
import { patchSettings, testMqttConnection } from '../lib/adminApi';

const MQTT_DEFAULTS = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegwall',
};

interface HaSetupWizardProps {
  settings: Settings;
  /** Called after HA publishing is enabled and settings saved. */
  onSaved?: () => void;
  /** Called if the wizard is dismissed without saving (e.g. a "Skip" in first-run). */
  onCancel?: () => void;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string };

/**
 * Guided 3-step Home Assistant setup: broker connection (with a live test), HA discovery
 * options, then enable + save. Reuses `settings.mqtt` (one connection, no separate HA
 * credential) and saves the FULL merged mqtt object so the Gen1/motion fields are preserved.
 * A blank password is omitted from the save so the stored secret is kept. Shared by the
 * standalone /admin/home-assistant route and the first-run WelcomePage step.
 */
export function HaSetupWizard({ settings, onSaved, onCancel }: HaSetupWizardProps) {
  const mqtt = settings.mqtt;
  const configured = mqtt !== null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [url, setUrl] = useState(mqtt?.url ?? '');
  const [username, setUsername] = useState(mqtt?.username ?? '');
  const [password, setPassword] = useState(''); // blank = keep existing
  const [discoveryPrefix, setDiscoveryPrefix] = useState(mqtt?.haDiscoveryPrefix ?? MQTT_DEFAULTS.haDiscoveryPrefix);
  const [appTopicPrefix, setAppTopicPrefix] = useState(mqtt?.appTopicPrefix ?? MQTT_DEFAULTS.appTopicPrefix);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function runTest() {
    setTest({ status: 'testing' });
    const res = await testMqttConnection({ url: url.trim(), username: username.trim() || undefined, password: password || undefined });
    if (res.ok) {
      setTest(res.data.ok ? { status: 'ok', detail: res.data.detail } : { status: 'fail', detail: res.data.detail });
    } else {
      setTest({ status: 'fail', detail: res.message });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const base = mqtt ?? {
      url: '', gen1TopicPrefix: MQTT_DEFAULTS.gen1TopicPrefix, haPublishEnabled: false,
      haDiscoveryPrefix: MQTT_DEFAULTS.haDiscoveryPrefix, appTopicPrefix: MQTT_DEFAULTS.appTopicPrefix,
      motionTopics: [],
    };
    const nextMqtt = {
      ...base,
      url: url.trim(),
      username: username.trim() || undefined,
      ...(password ? { password } : {}), // blank → omit → keep the stored secret
      haPublishEnabled: true,
      haDiscoveryPrefix: discoveryPrefix.trim() || MQTT_DEFAULTS.haDiscoveryPrefix,
      appTopicPrefix: appTopicPrefix.trim() || MQTT_DEFAULTS.appTopicPrefix,
    };
    const res = await patchSettings({ mqtt: nextMqtt });
    setSaving(false);
    if (res.ok) {
      onSaved?.();
    } else {
      setSaveError(res.message);
    }
  }

  return (
    <div className="ha-wizard" data-testid="ha-wizard">
      <p className="admin-page-quiet" data-testid="ha-wizard-step">Step {step} of 3</p>

      {step === 1 && (
        <div data-testid="ha-wizard-broker">
          <h2 className="font-display">Connect your MQTT broker</h2>
          <p className="admin-page-quiet">
            Home Assistant discovery rides your MQTT broker. Enter its address and credentials.
          </p>
          <label className="admin-field">
            <span>Broker URL</span>
            <input
              data-testid="ha-wizard-url" value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="mqtt://homeassistant.local:1883"
            />
          </label>
          <label className="admin-field">
            <span>Username (optional)</span>
            <input data-testid="ha-wizard-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="admin-field">
            <span>Password</span>
            <input
              type="password" data-testid="ha-wizard-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={configured ? 'Leave blank to keep the current password' : ''}
            />
          </label>
          <div className="ha-wizard__actions">
            <button
              type="button" data-testid="ha-wizard-test"
              onClick={runTest} disabled={!url.trim() || test.status === 'testing'}
            >
              {test.status === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {test.status === 'ok' && <span className="ha-wizard__result ha-wizard__result--ok" data-testid="ha-wizard-test-ok">✓ {test.detail}</span>}
            {test.status === 'fail' && <span className="ha-wizard__result ha-wizard__result--fail" data-testid="ha-wizard-test-fail">✕ {test.detail}</span>}
          </div>
          <div className="ha-wizard__nav">
            {onCancel && <button type="button" data-testid="ha-wizard-skip" onClick={onCancel}>Skip for now</button>}
            <button type="button" data-testid="ha-wizard-next" disabled={!url.trim()} onClick={() => setStep(2)}>Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div data-testid="ha-wizard-options">
          <h2 className="font-display">Home Assistant options</h2>
          <p className="admin-page-quiet">The defaults work for a standard Home Assistant install — change only if you know you need to.</p>
          <label className="admin-field">
            <span>Discovery prefix</span>
            <input data-testid="ha-wizard-discovery" value={discoveryPrefix} onChange={(e) => setDiscoveryPrefix(e.target.value)} />
          </label>
          <label className="admin-field">
            <span>App topic prefix</span>
            <input data-testid="ha-wizard-apptopic" value={appTopicPrefix} onChange={(e) => setAppTopicPrefix(e.target.value)} />
          </label>
          <div className="ha-wizard__nav">
            <button type="button" data-testid="ha-wizard-back" onClick={() => setStep(1)}>Back</button>
            <button type="button" data-testid="ha-wizard-next-2" onClick={() => setStep(3)}>Next</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div data-testid="ha-wizard-confirm">
          <h2 className="font-display">Enable Home Assistant publishing</h2>
          <p className="admin-page-quiet">
            Kegwall will publish its taps to <code>{discoveryPrefix.trim() || MQTT_DEFAULTS.haDiscoveryPrefix}</code> on
            {' '}<code>{url.trim()}</code>. Home Assistant discovers them automatically.
          </p>
          {saveError && <p className="admin-page-quiet ha-wizard__result--fail" data-testid="ha-wizard-save-error">{saveError}</p>}
          <div className="ha-wizard__nav">
            <button type="button" data-testid="ha-wizard-back-2" onClick={() => setStep(2)}>Back</button>
            <button type="button" data-testid="ha-wizard-save" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Enable & save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
