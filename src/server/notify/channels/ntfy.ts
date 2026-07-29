import type { NotificationSeverity } from '../../db/notificationsRepo.js';
import { withRetry, DEFAULT_TIMEOUT_MS } from '../retry.js';
import type { Channel, ChannelMessage, ChannelSendOptions } from './types.js';

export interface NtfyConfig {
  serverUrl: string;
  topic: string;
}

/** ntfy's `Priority` header accepts 1-5 (or the equivalent min/low/default/high/urgent
 * names) -- mapped from this app's 3-level severity so a message's urgency is at least
 * roughly reflected in the client's notification presentation. */
const SEVERITY_PRIORITY: Record<NotificationSeverity, string> = {
  info: '3',
  warning: '4',
  critical: '5',
};

/** Strips CR/LF from a value bound for an HTTP header -- ntfy's Title header is
 * caller-controlled (an automation's rendered `title`), and a raw newline in a header
 * value is both invalid HTTP and a (mild) header-injection vector. */
function sanitizeHeaderValue(v: string): string {
  return v.replace(/[\r\n]/g, ' ');
}

/**
 * ntfy sender: `POST {serverUrl}/{topic}` with the message text as the raw body and
 * `Title`/`Priority` headers (see https://docs.ntfy.sh/publish/#publish-as-json for the
 * header-based publish form this mirrors). No secret in this config (ntfy topics are not
 * modeled as credentials by the plan's `alertChannels` shape -- see `db/settings.ts`),
 * so nothing here needs masking; the server URL/topic are still kept out of every thrown
 * error message anyway, matching every other channel's redaction discipline.
 */
export class NtfyChannel implements Channel {
  readonly name = 'ntfy' as const;

  constructor(private readonly config: NtfyConfig, private readonly opts: ChannelSendOptions = {}) {}

  async send(msg: ChannelMessage): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = `${this.config.serverUrl.replace(/\/+$/, '')}/${this.config.topic}`;

    await withRetry(async () => {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Title: sanitizeHeaderValue(msg.title),
            Priority: SEVERITY_PRIORITY[msg.severity],
          },
          body: msg.body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Never surface the raw fetch error -- some failure modes embed the request URL
        // (see mdashClient.ts's identical rationale).
        throw new Error('ntfy: request failed (network error or timeout)');
      }
      if (!res.ok) throw new Error(`ntfy: request failed (status ${res.status})`);
    }, this.opts);
  }
}
