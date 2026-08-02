import type { NotificationSeverity } from '../../db/notificationsRepo.js';
import { withRetry, DEFAULT_TIMEOUT_MS } from '../retry.js';
import type { Channel, ChannelMessage, ChannelSendOptions } from './types.js';

export interface PushoverConfig {
  token: string;
  user: string;
}

const DEFAULT_BASE_URL = 'https://api.pushover.net';

/** Pushover priority: -1 (low, no sound) / 0 (normal) / 1 (high) / 2 (emergency,
 * requires retry/expire — deliberately NOT used here, since this app has no
 * acknowledgment callback endpoint for Pushover to call back into). */
const SEVERITY_PRIORITY: Record<NotificationSeverity, string> = {
  info: '-1',
  warning: '0',
  critical: '1',
};

export interface PushoverChannelOptions extends ChannelSendOptions {
  /** Test-only override of Pushover's real API host — same test-injectable-base-URL
   * pattern as `kegtronBaseUrl`/`openBreweryBaseUrl` (`db/settings.ts`). */
  baseUrl?: string;
}

/**
 * Pushover sender: `POST {baseUrl}/1/messages.json`, form-encoded (`token`, `user`,
 * `title`, `message`, `priority`) — the shape Pushover's API requires
 * (https://pushover.net/api). `token`/`user` are both secrets (see
 * `db/settings.ts`'s `alertChannels.pushover.token` masking) — sent only in the request
 * body, never echoed into any thrown error message.
 */
export class PushoverChannel implements Channel {
  readonly name = 'pushover' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: PushoverConfig, private readonly opts: PushoverChannelOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  async send(msg: ChannelMessage): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = `${this.baseUrl.replace(/\/+$/, '')}/1/messages.json`;

    await withRetry(async () => {
      const body = new URLSearchParams({
        token: this.config.token,
        user: this.config.user,
        title: msg.title,
        message: msg.body,
        priority: SEVERITY_PRIORITY[msg.severity],
      });
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST', body, signal: AbortSignal.timeout(timeoutMs),
          // A guard-passing host must not 307 this POST (which carries token+user) at an
          // internal address — same SSRF closure as webhookSender.ts.
          redirect: 'error',
        });
      } catch {
        throw new Error('pushover: request failed (network error or timeout)');
      }
      if (!res.ok) throw new Error(`pushover: request failed (status ${res.status})`);
    }, this.opts);
  }
}
