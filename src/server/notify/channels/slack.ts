import { withRetry, DEFAULT_TIMEOUT_MS } from '../retry.js';
import type { Channel, ChannelMessage, ChannelSendOptions } from './types.js';

export interface SlackConfig {
  webhookUrl: string;
}

/**
 * Slack sender: `POST {webhookUrl}` with a Block Kit `blocks` payload — a `header` block
 * for the title, a `section` (mrkdwn) block for the body
 * (https://api.slack.com/messaging/webhooks). The webhook URL itself IS the secret
 * (Slack embeds an unguessable token in its path — see `db/settings.ts`'s
 * `alertChannels.slack.webhookUrl` masking, "origin + '/…'") — never included in any
 * thrown error message.
 */
export class SlackChannel implements Channel {
  readonly name = 'slack' as const;

  constructor(private readonly config: SlackConfig, private readonly opts: ChannelSendOptions = {}) {}

  async send(msg: ChannelMessage): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const payload = JSON.stringify({
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: msg.title } },
        { type: 'section', text: { type: 'mrkdwn', text: msg.body } },
      ],
    });

    await withRetry(async () => {
      let res: Response;
      try {
        res = await fetchImpl(this.config.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error('slack: request failed (network error or timeout)');
      }
      if (!res.ok) throw new Error(`slack: request failed (status ${res.status})`);
    }, this.opts);
  }
}
