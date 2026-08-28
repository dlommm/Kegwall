import { useState } from 'react';
import type { Settings } from '../../../../server/db/settings.js';
import { testChannel } from '../../../lib/adminApi';
import type { GroupProps } from './shared';
import { MaskedSecretField, useMaskedSecret } from './MaskedSecretField';
import { useSettingsGroupForm } from './useSettingsGroupForm';

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

  const dirty = serverUrl !== (cfg?.serverUrl ?? '') || topic !== (cfg?.topic ?? '');

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      if (!serverUrl.trim() || !topic.trim()) {
        return 'Server URL and topic are both required.';
      }
      return {
        alertChannels: { ...alertChannels, ntfy: { serverUrl: serverUrl.trim(), topic: topic.trim() } },
      };
    },
  });

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
  const token = useMaskedSecret();

  const dirty = user !== (cfg?.user ?? '') || token.dirty;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      const tokenValue = token.newValue ?? cfg?.token;
      if (!user.trim() || !tokenValue) {
        return 'A Pushover user key and app token are both required.';
      }
      return {
        alertChannels: { ...alertChannels, pushover: { token: tokenValue, user: user.trim() } },
      };
    },
    onSuccess: token.reset,
  });

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
        {...token.fieldProps}
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
  const password = useMaskedSecret();

  const dirty = host !== (cfg?.host ?? '')
    || port !== String(cfg?.port ?? 587)
    || secure !== (cfg?.secure ?? false)
    || user !== (cfg?.user ?? '')
    || from !== (cfg?.from ?? '')
    || to !== (cfg?.to ?? '')
    || password.dirty;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    buildPatch: () => {
      const portNum = Number(port);
      if (!host.trim() || !Number.isInteger(portNum) || portNum <= 0 || !from.trim() || !to.trim()) {
        return 'Host, a valid port, from, and to are all required.';
      }
      return {
        alertChannels: {
          ...alertChannels,
          smtp: {
            host: host.trim(),
            port: portNum,
            secure,
            user: user.trim() || undefined,
            password: password.newValue ?? cfg?.password,
            from: from.trim(),
            to: to.trim(),
          },
        },
      };
    },
    onSuccess: password.reset,
  });

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
        {...password.fieldProps}
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
  const webhookUrl = useMaskedSecret();

  const dirty = webhookUrl.dirty;

  const { submitting, error, handleSubmit } = useSettingsGroupForm({
    dirty,
    onSaved,
    // `!`: the hook only submits while dirty, and this block's ONLY dirty term is a
    // freshly typed URL — `newValue` is defined on every reachable path.
    buildPatch: () => ({
      alertChannels: { ...alertChannels, [name]: { webhookUrl: webhookUrl.newValue! } },
    }),
    onSuccess: webhookUrl.reset,
  });

  return (
    <form className="channels-group__block" data-testid={`settings-channels-${name}`} onSubmit={handleSubmit}>
      <h3 className="channels-group__block-title">{label}</h3>
      <MaskedSecretField
        label="Webhook URL"
        testId={`settings-channels-${name}-webhook`}
        maskedValue={cfg?.webhookUrl}
        {...webhookUrl.fieldProps}
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
export function ChannelsGroup({ settings, onSaved }: GroupProps) {
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
