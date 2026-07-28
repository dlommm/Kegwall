import type { SettingsStore } from '../../db/settings.js';
import { NtfyChannel } from './ntfy.js';
import { PushoverChannel } from './pushover.js';
import { SmtpChannel } from './smtp.js';
import { DiscordChannel } from './discord.js';
import { SlackChannel } from './slack.js';
import type { Channel } from './types.js';

export { InAppChannel } from './inApp.js';
export { NtfyChannel } from './ntfy.js';
export { PushoverChannel } from './pushover.js';
export { SmtpChannel } from './smtp.js';
export { DiscordChannel } from './discord.js';
export { SlackChannel } from './slack.js';
export type { Channel, ChannelMessage, ChannelSendOptions } from './types.js';

/** The 5 settings-configured channel names — `POST /api/channels/:name/test`
 * (`routes/channels.ts`) is scoped to exactly these; `inApp` has no settings/no
 * send-test entry (it's always available, no config to test), and `webhook`/`mqtt` are
 * per-automation-action senders (`webhookSender.ts`/`mqttSender.ts`), not
 * settings-configured channels at all — see `db/settings.ts`'s `alertChannels` schema,
 * which is the single source of truth this list mirrors. */
export const ALERT_CHANNEL_NAMES = ['ntfy', 'pushover', 'smtp', 'discord', 'slack'] as const;

export type AlertChannelName = (typeof ALERT_CHANNEL_NAMES)[number];

/**
 * Builds the live `Channel` for `name` from CURRENT settings, or `null` if that channel
 * has no config saved yet. Both the send-test route and (from Task 3 on) the engine's
 * `notify` action share this factory so "what does `alertChannels.ntfy` turn into" has
 * exactly one answer. Building fresh on every call (rather than caching an instance)
 * means a settings PATCH is picked up on the very next send — no stale-channel-instance
 * problem to invalidate.
 */
export function buildAlertChannel(settings: SettingsStore, name: AlertChannelName): Channel | null {
  const cfg = settings.get('alertChannels');
  switch (name) {
    case 'ntfy':
      return cfg.ntfy ? new NtfyChannel(cfg.ntfy) : null;
    case 'pushover':
      return cfg.pushover ? new PushoverChannel(cfg.pushover) : null;
    case 'smtp':
      return cfg.smtp ? new SmtpChannel(cfg.smtp) : null;
    case 'discord':
      return cfg.discord ? new DiscordChannel(cfg.discord) : null;
    case 'slack':
      return cfg.slack ? new SlackChannel(cfg.slack) : null;
  }
}
