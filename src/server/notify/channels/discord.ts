import type { NotificationSeverity } from '../../db/notificationsRepo.js';
import { withRetry, DEFAULT_TIMEOUT_MS } from '../retry.js';
import type { Channel, ChannelMessage, ChannelSendOptions } from './types.js';

export interface DiscordConfig {
  webhookUrl: string;
}

/** Discord embed `color` is a decimal-encoded RGB int (0xRRGGBB) — a distinct accent
 * color per severity so a channel scanning quickly can tell warning/critical apart from
 * routine info at a glance. */
const SEVERITY_COLOR: Record<NotificationSeverity, number> = {
  info: 0x3b82f6, // blue
  warning: 0xf59e0b, // amber
  critical: 0xef4444, // red
};

/**
 * Discord sender: `POST {webhookUrl}` with a single embed (`title`/`description`/
 * `color`) — https://discord.com/developers/docs/resources/webhook#execute-webhook. The
 * webhook URL itself IS the secret (Discord embeds an unguessable token in its path —
 * see `db/settings.ts`'s `alertChannels.discord.webhookUrl` masking, "origin + '/…'") —
 * never included in any thrown error message.
 */
export class DiscordChannel implements Channel {
  readonly name = 'discord' as const;

  constructor(private readonly config: DiscordConfig, private readonly opts: ChannelSendOptions = {}) {}

  async send(msg: ChannelMessage): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const payload = JSON.stringify({
      embeds: [{ title: msg.title, description: msg.body, color: SEVERITY_COLOR[msg.severity] }],
    });

    await withRetry(async () => {
      let res: Response;
      try {
        res = await fetchImpl(this.config.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
          // A guard-passing host must not 307 this POST at an internal address — same SSRF
          // closure as webhookSender.ts. A redirect throws, folded into the message below.
          redirect: 'error',
        });
      } catch {
        // Never surface the raw fetch error — it can embed the request URL, which for
        // Discord carries the webhook's secret token in its path.
        throw new Error('discord: request failed (network error or timeout)');
      }
      if (!res.ok) throw new Error(`discord: request failed (status ${res.status})`);
    }, this.opts);
  }
}
